import { fail } from "../domain/errors.js";

const ACTIVE_STATUSES = ["waiting", "offered", "accepting", "accepted"];

function requireUser(user) {
  if (!user || typeof user !== "object" || typeof user.id !== "string" || !user.id.trim()) {
    fail("UNAUTHENTICATED", "Authentication required");
  }
  return user;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("VALIDATION", `${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireQuantity(value) {
  const quantity = value === undefined ? 1 : value;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    fail("VALIDATION", "quantity must be an integer between 1 and 10");
  }
  return quantity;
}

export function createWaitlistService(repo, { clock, seatService, bookingService } = {}) {
  if (!repo) fail("VALIDATION", "repo is required");
  if (!clock || typeof clock.nowMs !== "function") fail("VALIDATION", "clock is required");
  if (!seatService) fail("VALIDATION", "seatService is required");
  if (!bookingService) fail("VALIDATION", "bookingService is required");

  async function joinWaitlist(input, user) {
    const u = requireUser(user);
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      fail("VALIDATION", "input must be an object");
    }
    const tierId = requireString(input.tierId, "tierId");
    const quantity = requireQuantity(input.quantity);

    const tier = await repo.getTierById(tierId);
    if (!tier) fail("NOT_FOUND", `tier not found: ${tierId}`);
    if (tier.capacity - tier.sold > 0) {
      fail("NOT_SOLD_OUT", "This tier still has seats; book them instead");
    }

    const existing = await repo.listWaitlistEntries({ tierId, userId: u.id });
    if (existing.some((entry) => ACTIVE_STATUSES.includes(entry.status))) {
      fail("ALREADY_ON_WAITLIST", "You are already on this waitlist");
    }

    return repo.createWaitlistEntry({
      tierId,
      userId: u.id,
      quantity,
      status: "waiting",
      createdAt: clock.nowIso(),
    });
  }

  /** Own entries, with a queue position for the ones still waiting. */
  async function listMyWaitlist(user) {
    const u = requireUser(user);
    // Include expired entries too, so a user can see why an offer disappeared.
    const mine = await repo.listWaitlistEntries({ userId: u.id });
    const positions = new Map();
    for (const tier of await repo.listTiers()) {
      const queue = await repo.listWaitlistEntries({ tierId: tier.id, status: "waiting" });
      queue.forEach((entry, index) => positions.set(entry.id, index + 1));
    }
    return mine.map((entry) => ({
      ...entry,
      position: positions.get(entry.id) ?? null,
      expired: entry.status === "offered" && seatService.isExpired(entry),
    }));
  }

  async function acceptOffer(entryId, user) {
    const u = requireUser(user);
    const id = requireString(entryId, "entryId");
    const entry = await repo.getWaitlistEntryById(id);
    if (!entry) fail("NOT_FOUND", `waitlist entry not found: ${id}`);
    if (entry.userId !== u.id) fail("FORBIDDEN", "Not your offer");
    if (entry.status === "expired") {
      fail("OFFER_EXPIRED", "This offer has expired. The seat was offered to the next person.");
    }
    if (entry.status !== "offered") fail("INVALID_STATE", "This offer is no longer active");

    if (seatService.isExpired(entry)) {
      // Release the expired hold and pass the seat on before telling the user.
      await seatService.expireOffer(id);
      fail("OFFER_EXPIRED", "This offer has expired. The seat was offered to the next person.");
    }

    // Claim the offer before creating a booking, otherwise two tabs could
    // accept the same offer and use the same held seats twice.
    const claimed = await repo.compareAndSetWaitlistStatus(id, "offered", "accepting", {
      offerExpiresAt: entry.offerExpiresAt,
    });
    if (!claimed) fail("INVALID_STATE", "This offer was already accepted");

    try {
      const booking = await bookingService.createBookingFromOffer(claimed, u);
      const accepted = await repo.saveWaitlistEntry({
        ...claimed,
        status: "accepted",
        acceptedBookingId: booking.id,
      });
      return { entry: accepted, booking };
    } catch (err) {
      // Put the offer back if we could not create the booking. The held seats
      // were never given to another booking, so no release is needed here.
      await repo.saveWaitlistEntry({ ...claimed, status: "offered" });
      throw err;
    }
  }

  return { joinWaitlist, listMyWaitlist, acceptOffer };
}
