import { DomainError, fail } from "../domain/errors.js";
import { createClock } from "../lib/clock.js";
import { signTicketToken, verifyTicketToken } from "../lib/ticketToken.js";

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

function requireUser(user) {
  if (!user || typeof user !== "object" || typeof user.id !== "string" || !user.id.trim()) {
    fail("UNAUTHENTICATED", "Authentication required");
  }
  return user;
}

/** Check-in is deliberately restricted to the staff role (S14/S15). */
function requireStaff(user) {
  const u = requireUser(user);
  if (u.role !== "staff") {
    fail("FORBIDDEN", "Staff access required");
  }
  return u;
}

/**
 * Build 9: ticket issuance and door check-in.
 *
 * The QR code contains only a signed booking reference + issued-at time. The
 * service looks up the booking on the server; no name or email ever goes into
 * the code a camera can read.
 */
export function createCheckinService(repo, { clock = createClock() } = {}) {
  if (!repo || typeof repo.getBookingByReference !== "function") {
    fail("VALIDATION", "checkinService requires a booking-aware repository");
  }

  /**
   * Return a deterministic code for a paid booking. Using paidAt as issuedAt
   * means refreshing the tickets page produces the same scannable QR.
   */
  async function getTicket(reference, user) {
    const u = requireUser(user);
    const ref = assertNonEmptyString(reference, "reference");
    const booking = await repo.getBookingByReference(ref);
    if (!booking) fail("NOT_FOUND", `booking not found: ${ref}`);
    if (booking.userId !== u.id) fail("FORBIDDEN", "Not your booking");
    if (!["paid", "checked_in"].includes(booking.status)) {
      fail("INVALID_STATE", "Only paid bookings have a QR ticket");
    }

    const issuedAtMs = Date.parse(booking.paidAt || booking.createdAt);
    if (!Number.isFinite(issuedAtMs)) {
      fail("INVALID_STATE", "Ticket cannot be issued for this booking");
    }

    return {
      code: signTicketToken({ reference: booking.reference, issuedAtMs }),
      reference: booking.reference,
      eventId: booking.eventId,
      status: booking.status,
      checkedInAt: booking.checkedInAt,
    };
  }

  /**
   * Redeem a code. A single conditional UPDATE decides the winner; two staff
   * scanning together cannot both succeed. `eventId` is optional but, when
   * supplied, rejects a ticket for a different event.
   */
  async function checkIn(input, user) {
    const staff = requireStaff(user);
    assertObject(input, "input");
    const code = assertNonEmptyString(input.code, "code");

    // Any edited/made-up code fails here before we touch the database.
    const { reference } = verifyTicketToken(code);

    const booking = await repo.getBookingByReference(reference);
    if (!booking || !["paid", "checked_in"].includes(booking.status)) {
      // Deliberately vague: do not leak which references exist or their state.
      fail("INVALID_TICKET", "This ticket is not valid for check-in");
    }

    if (input.eventId !== undefined && input.eventId !== null && String(input.eventId).trim() !== "") {
      const eventId = assertNonEmptyString(input.eventId, "eventId");
      if (booking.eventId !== eventId) {
        fail("WRONG_EVENT", "This ticket is for a different event");
      }
    }

    const result = await repo.checkInBookingWithCas({
      id: booking.id,
      from: "paid",
      to: "checked_in",
      checkedInAt: clock.nowIso(),
      checkedInBy: staff.id,
    });

    if (!result) fail("INVALID_TICKET", "This ticket is not valid for check-in");
    if (result.conflict) {
      const current = result.booking;
      if (current?.status === "checked_in") {
        const error = new DomainError(
          "DUPLICATE_CHECKIN",
          `Ticket already checked in at ${current.checkedInAt}`,
        );
        error.checkedInAt = current.checkedInAt;
        error.reference = current.reference;
        throw error;
      }
      fail("INVALID_TICKET", "This ticket is not valid for check-in");
    }

    return {
      reference: result.booking.reference,
      eventId: result.booking.eventId,
      status: result.booking.status,
      checkedInAt: result.booking.checkedInAt,
      checkedInBy: result.booking.checkedInBy,
    };
  }

  return { getTicket, checkIn };
}
