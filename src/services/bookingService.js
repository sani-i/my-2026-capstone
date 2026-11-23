import { fail } from "../domain/errors.js";
import { assertTransition } from "../domain/bookingStateMachine.js";
import { calculateRefund } from "../domain/refundPolicy.js";
import { HOLD_MS } from "../domain/timings.js";
import { createClock } from "../lib/clock.js";

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

export function createBookingService(
  repo,
  paymentGateway,
  { clock = createClock(), seatService, holdMs = HOLD_MS } = {},
) {
  if (!repo) fail("VALIDATION", "repo is required");
  if (!paymentGateway) fail("VALIDATION", "paymentGateway is required");
  if (!clock || typeof clock.nowMs !== "function") fail("VALIDATION", "clock is required");

  function holdExpiryFor(booking) {
    if (booking.holdExpiresAt) return Date.parse(booking.holdExpiresAt);
    // Bookings created before Build 8 have no explicit expiry column.
    return Date.parse(booking.createdAt) + holdMs;
  }

  function isHoldExpired(booking) {
    return holdExpiryFor(booking) <= clock.nowMs();
  }

  function newHoldExpiresAt() {
    return new Date(clock.nowMs() + holdMs).toISOString();
  }

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
        createdAt: clock.nowIso(),
        holdExpiresAt: newHoldExpiresAt(),
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

  /** Create the pending booking after a waitlist offer was accepted. The seats
   * are already held by the offer, so this must NOT reserve them again. */
  async function createBookingFromOffer(entry, user) {
    const u = requireUser(user);
    if (!entry || !["offered", "accepting"].includes(entry.status)) {
      fail("INVALID_STATE", "No active offer");
    }
    if (entry.userId !== u.id) fail("FORBIDDEN", "Not your offer");
    const tier = await repo.getTierById(entry.tierId);
    if (!tier) fail("NOT_FOUND", `tier not found: ${entry.tierId}`);
    const event = await repo.getEventById(tier.eventId);
    if (!event || event.status !== "published") {
      fail("INVALID_STATE", "event is not published");
    }
    return repo.createBooking({
      eventId: event.id,
      tierId: tier.id,
      userId: u.id,
      quantity: entry.quantity,
      amountCents: tier.priceCents * entry.quantity,
      status: "pending",
      createdAt: clock.nowIso(),
      holdExpiresAt: newHoldExpiresAt(),
    });
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

  /** What the UI shows before the attendee confirms a cancellation. */
  async function getCancellationQuote(reference, user) {
    const booking = await getBooking(reference, user);
    if (booking.status === "paid") {
      const event = await repo.getEventById(booking.eventId);
      if (!event) fail("NOT_FOUND", `event not found: ${booking.eventId}`);
      const quote = calculateRefund({
        amountCents: booking.amountCents,
        startsAt: event.startsAt,
        now: clock.now(),
      });
      return { ...quote, status: "paid", reference: booking.reference };
    }
    if (booking.status === "pending") {
      return {
        refundCents: 0,
        percent: 0,
        amountCents: booking.amountCents,
        status: "pending",
        reference: booking.reference,
      };
    }
    fail("INVALID_STATE", "This booking can no longer be cancelled");
  }

  async function payBooking(reference, input, user) {
    const u = requireUser(user);
    const ref = assertNonEmptyString(reference, "reference");
    assertObject(input, "input");
    const paymentToken = assertNonEmptyString(input.paymentToken, "paymentToken");

    const booking = await repo.getBookingByReference(ref);
    if (!booking) fail("NOT_FOUND", `booking not found: ${ref}`);
    assertBookingOwner(booking, u);

    // S10: an expired hold cannot be paid, even if the job has not run yet.
    if (isHoldExpired(booking)) {
      fail("BOOKING_EXPIRED", "The seat hold expired. Please book again.");
    }

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
    booking.paidAt = clock.nowIso();
    booking.chargeId = result.chargeId;
    return repo.saveBooking(booking);
  }

  async function cancelBooking(reference, user) {
    const u = requireUser(user);
    const ref = assertNonEmptyString(reference, "reference");
    const booking = await repo.getBookingByReference(ref);
    if (!booking) fail("NOT_FOUND", `booking not found: ${ref}`);
    assertBookingOwner(booking, u);

    if (booking.status === "cancelled" || booking.status === "refunded") {
      fail("INVALID_STATE", "booking is already cancelled");
    }

    const at = clock.nowIso();
    let toStatus = "cancelled";
    let refundCents;
    let refundedAt;

    if (booking.status === "paid") {
      const event = await repo.getEventById(booking.eventId);
      if (!event) fail("NOT_FOUND", `event not found: ${booking.eventId}`);
      const quote = calculateRefund({
        amountCents: booking.amountCents,
        startsAt: event.startsAt,
        now: clock.now(),
      });
      toStatus = "refunded";
      refundCents = quote.refundCents;
      refundedAt = at;
    } else if (booking.status !== "pending") {
      fail("INVALID_STATE", `cannot cancel a ${booking.status} booking`);
    }

    assertTransition(booking.status, toStatus);

    // Compare-and-set in the repository: exactly one caller changes the status
    // and releases the seats. A losing concurrent call gets { conflict: true }.
    const result = await repo.cancelBookingWithRelease({
      id: booking.id,
      from: booking.status,
      to: toStatus,
      cancelledAt: at,
      refundCents,
      refundedAt,
    });
    if (!result || result.conflict) {
      fail("INVALID_STATE", "booking is already cancelled");
    }

    let saved = result.booking;
    if (toStatus === "refunded") {
      // The gateway is called only by the caller that won the compare-and-set.
      const refund = await paymentGateway.refund({
        chargeId: booking.chargeId,
        amountCents: booking.amountCents,
        refundCents,
        reference: booking.reference,
      });
      if (!refund?.ok) fail(refund?.code || "REFUND_FAILED", refund?.message || "Refund failed");
      saved = await repo.saveBooking({ ...saved, refundId: refund.refundId });
    }

    if (seatService) await seatService.offerNext(booking.tierId);
    return saved;
  }

  /** S10: cancel expired pending holds and free their seats exactly once. */
  async function expireUnpaidBookings() {
    const pending = await repo.listBookingsByStatus("pending");
    const expired = pending.filter((booking) => isHoldExpired(booking));
    const tierIds = new Set();
    let count = 0;

    for (const booking of expired) {
      const result = await repo.cancelBookingWithRelease({
        id: booking.id,
        from: "pending",
        to: "cancelled",
        cancelledAt: clock.nowIso(),
      });
      if (result && !result.conflict) {
        count += 1;
        tierIds.add(booking.tierId);
      }
    }
    for (const tierId of tierIds) {
      if (seatService) await seatService.offerNext(tierId);
    }
    return { count, tierIds: [...tierIds] };
  }

  return {
    bookTickets,
    createBookingFromOffer,
    getBooking,
    listMyBookings,
    getCancellationQuote,
    payBooking,
    cancelBooking,
    expireUnpaidBookings,
  };
}
