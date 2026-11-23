import { fail } from "../domain/errors.js";
import { assertTransition } from "../domain/bookingStateMachine.js";

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("VALIDATION", `${label} must be an object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("VALIDATION", `${label} must be a non-empty string`);
  }
  return value.trim();
}

/** Build 7: identity comes from a verified token, never from a request header. */
function requireUser(user) {
  if (!user || typeof user !== "object" || typeof user.id !== "string" || !user.id.trim()) {
    fail("UNAUTHENTICATED", "Authentication required");
  }
  return user;
}

function assertBookingOwner(booking, user) {
  // Story S13 says another person's booking is FORBIDDEN. The Build 7 AI prompt
  // suggested NOT_FOUND to avoid leaking existence; we follow the user story
  // (and the existing tests) and keep the same rule for view/pay/cancel.
  if (booking.userId !== user.id) {
    fail("FORBIDDEN", "Not your booking");
  }
}

function assertQuantity(value) {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    fail("VALIDATION", "quantity must be an integer between 1 and 10");
  }
  return value;
}

export function createBookingService(repo, paymentGateway) {
  if (!repo) fail("VALIDATION", "repo is required");
  if (!paymentGateway) fail("VALIDATION", "paymentGateway is required");

  async function bookTickets(input, user) {
    const u = requireUser(user);
    assertObject(input, "input");
    const tierId = assertNonEmptyString(input.tierId, "tierId");
    const quantity = assertQuantity(input.quantity);

    const tier = await repo.getTierById(tierId);
    if (!tier) fail("NOT_FOUND", `tier not found: ${tierId}`);
    const event = await repo.getEventById(tier.eventId);
    if (!event) fail("NOT_FOUND", `event not found: ${tier.eventId}`);
    if (event.status !== "published") {
      fail("INVALID_STATE", "cannot book tickets for an unpublished event");
    }

    // Build 5: atomic reservation in the database/repo. No read-check-write.
    await repo.reserveSeats(tierId, quantity);

    let booking;
    try {
      booking = await repo.createBooking({
        eventId: event.id,
        tierId: tier.id,
        userId: u.id,
        quantity,
        amountCents: tier.priceCents * quantity,
        status: "pending",
      });
    } catch (err) {
      // If booking creation fails after seats reserved, release them.
      try {
        await repo.releaseSeats(tierId, quantity);
      } catch {
        // best effort release
      }
      throw err;
    }
    return booking;
  }

  async function getBooking(reference, user) {
    const u = requireUser(user);
    const ref = assertNonEmptyString(reference, "reference");
    const booking = await repo.getBookingByReference(ref);
    if (!booking) fail("NOT_FOUND", `booking not found: ${ref}`);
    assertBookingOwner(booking, u);
    return booking;
  }

  /** Only the bookings belonging to the authenticated user. */
  async function listMyBookings(user) {
    const u = requireUser(user);
    const bookings = await repo.listBookingsByUserId(u.id);
    return bookings.filter((b) => b.userId === u.id);
  }

  async function payBooking(reference, input, user) {
    const u = requireUser(user);
    const ref = assertNonEmptyString(reference, "reference");
    assertObject(input, "input");
    const paymentToken = assertNonEmptyString(input.paymentToken, "paymentToken");

    const booking = await repo.getBookingByReference(ref);
    if (!booking) fail("NOT_FOUND", `booking not found: ${ref}`);
    assertBookingOwner(booking, u);

    // S07: already paid -> rejected and card charged only once. Check before charging.
    if (booking.status === "paid") {
      fail("INVALID_TRANSITION", "booking is already paid");
    }
    // Validate transition (e.g. cancelled -> paid is INVALID_TRANSITION)
    assertTransition(booking.status, "paid");

    const result = await paymentGateway.charge({
      amountCents: booking.amountCents,
      paymentToken,
      reference: booking.reference,
    });

    if (!result?.ok) {
      // Declined: booking stays pending.
      fail(result?.code || "PAYMENT_DECLINED", result?.message || "Card declined");
    }

    booking.status = "paid";
    booking.paidAt = new Date().toISOString();
    booking.chargeId = result.chargeId;
    return repo.saveBooking(booking);
  }

  async function cancelBooking(reference, user) {
    const u = requireUser(user);
    const ref = assertNonEmptyString(reference, "reference");
    const booking = await repo.getBookingByReference(ref);
    if (!booking) fail("NOT_FOUND", `booking not found: ${ref}`);
    assertBookingOwner(booking, u);

    if (booking.status !== "pending") {
      // unpaid bookings only for now; paid -> INVALID_STATE per examples
      fail("INVALID_STATE", "only unpaid pending bookings can be cancelled here");
    }

    // Transition pending -> cancelled
    assertTransition(booking.status, "cancelled");

    await repo.releaseSeats(booking.tierId, booking.quantity);

    booking.status = "cancelled";
    booking.cancelledAt = new Date().toISOString();
    return repo.saveBooking(booking);
  }

  return {
    bookTickets,
    getBooking,
    listMyBookings,
    payBooking,
    cancelBooking,
  };
}
