import { newId, newReference } from "../domain/ids.js";
import { fail } from "../domain/errors.js";

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

/**
 * In-memory repository. Async methods for events, tiers and bookings.
 * Services receive the repository as an argument; they do not import it.
 * The critical sections contain no await, so they are atomic in one process.
 */
export function createMemoryRepository() {
  const users = new Map();
  const usersByEmail = new Map();
  const events = new Map();
  const tiers = new Map();
  const bookings = new Map();
  const bookingsByReference = new Map();
  const waitlist = new Map();

  return {
    async createUser(data) {
      if (usersByEmail.has(data.email)) {
        fail("EMAIL_TAKEN", "Email is already registered");
      }
      const user = {
        id: data.id,
        name: data.name || "",
        email: data.email,
        role: data.role,
        passwordHash: data.passwordHash,
      };
      users.set(user.id, user);
      usersByEmail.set(user.email, user);
      return clone(user);
    },

    async getUserByEmail(email) {
      return clone(usersByEmail.get(email));
    },

    async getUserById(id) {
      return clone(users.get(id));
    },

    async createEvent(data) {
      const event = {
        id: newId(),
        organizerId: data.organizerId,
        title: data.title,
        city: data.city,
        venue: data.venue,
        startsAt: data.startsAt,
        status: "draft",
        tierIds: [],
      };
      events.set(event.id, event);
      return clone(event);
    },

    async getEventById(id) {
      return clone(events.get(id));
    },

    async saveEvent(event) {
      const stored = { ...clone(event), tierIds: [...(event.tierIds || [])] };
      events.set(stored.id, stored);
      return clone(stored);
    },

    async listEvents() {
      return [...events.values()].map(clone);
    },

    async listEventsByOrganizerId(organizerId) {
      return [...events.values()].filter((e) => e.organizerId === organizerId).map(clone);
    },

    async createTier(data) {
      const tier = {
        id: newId(),
        eventId: data.eventId,
        name: data.name,
        priceCents: data.priceCents,
        capacity: data.capacity,
        sold: 0,
      };
      tiers.set(tier.id, tier);
      const event = events.get(data.eventId);
      if (event && !event.tierIds.includes(tier.id)) {
        event.tierIds.push(tier.id);
      }
      return clone(tier);
    },

    async getTierById(id) {
      return clone(tiers.get(id));
    },

    async saveTier(tier) {
      const stored = clone(tier);
      tiers.set(stored.id, stored);
      return clone(stored);
    },

    async listTiersByEventId(eventId) {
      return [...tiers.values()].filter((t) => t.eventId === eventId).map(clone);
    },

    async listTiers() {
      return [...tiers.values()].map(clone);
    },

    async createBooking(data) {
      const booking = {
        id: newId(),
        reference: newReference(),
        eventId: data.eventId,
        tierId: data.tierId,
        userId: data.userId,
        quantity: data.quantity,
        amountCents: data.amountCents,
        status: data.status ?? "pending",
        createdAt: data.createdAt || new Date().toISOString(),
        holdExpiresAt: data.holdExpiresAt,
        refundCents: data.refundCents,
        refundedAt: data.refundedAt,
        refundId: data.refundId,
      };
      bookings.set(booking.id, booking);
      bookingsByReference.set(booking.reference, booking.id);
      return clone(booking);
    },

    async getBookingById(id) {
      return clone(bookings.get(id));
    },

    async getBookingByReference(reference) {
      const id = bookingsByReference.get(reference);
      if (!id) return undefined;
      return clone(bookings.get(id));
    },

    async saveBooking(booking) {
      const stored = clone(booking);
      bookings.set(stored.id, stored);
      bookingsByReference.set(stored.reference, stored.id);
      return clone(stored);
    },

    async listBookings() {
      return [...bookings.values()].map(clone);
    },

    async listBookingsByUserId(userId) {
      return [...bookings.values()].filter((b) => b.userId === userId).map(clone);
    },

    async listBookingsByStatus(status) {
      return [...bookings.values()].filter((b) => b.status === status).map(clone);
    },

    /** Compare-and-set plus seat release, atomic in this single process. */
    async cancelBookingWithRelease({ id, from, to, cancelledAt, refundCents, refundedAt, refundId }) {
      const booking = bookings.get(id);
      if (!booking) return null;
      if (booking.status !== from) {
        return { conflict: true, booking: clone(booking) };
      }
      const tier = tiers.get(booking.tierId);
      if (!tier || tier.sold < booking.quantity) {
        fail("INVALID_STATE", "Could not release seats for this booking");
      }
      tier.sold -= booking.quantity;
      booking.status = to;
      booking.cancelledAt = cancelledAt;
      booking.refundCents = refundCents;
      booking.refundedAt = refundedAt;
      booking.refundId = refundId;
      return { booking: clone(booking) };
    },

    /**
     * Atomically reserve seats. If not enough seats, throw SOLD_OUT.
     */
    async reserveSeats(tierId, quantity) {
      const tier = tiers.get(tierId);
      if (!tier) fail("NOT_FOUND", `tier not found: ${tierId}`);
      const remaining = tier.capacity - tier.sold;
      if (quantity > remaining) {
        fail("SOLD_OUT", `Only ${remaining} ticket(s) left in ${tier.name}`);
      }
      tier.sold += quantity;
      return clone(tier);
    },

    /**
     * Release seats (used for cancellations).
     */
    async releaseSeats(tierId, quantity) {
      const tier = tiers.get(tierId);
      if (!tier) fail("NOT_FOUND", `tier not found: ${tierId}`);
      tier.sold = Math.max(0, tier.sold - quantity);
      return clone(tier);
    },

    // --- Build 8 waitlist -------------------------------------------------
    async createWaitlistEntry(data) {
      const entry = {
        id: newId(),
        tierId: data.tierId,
        userId: data.userId,
        quantity: data.quantity ?? 1,
        status: data.status ?? "waiting",
        createdAt: data.createdAt || new Date().toISOString(),
        offerExpiresAt: data.offerExpiresAt,
      };
      waitlist.set(entry.id, entry);
      return clone(entry);
    },

    async getWaitlistEntryById(id) {
      return clone(waitlist.get(id));
    },

    async listWaitlistEntries(filters = {}) {
      return [...waitlist.values()]
        .filter((entry) => {
          if (filters.tierId !== undefined && entry.tierId !== filters.tierId) return false;
          if (filters.userId !== undefined && entry.userId !== filters.userId) return false;
          if (filters.status !== undefined && entry.status !== filters.status) return false;
          return true;
        })
        .map(clone);
    },

    async saveWaitlistEntry(entry) {
      const stored = clone(entry);
      waitlist.set(stored.id, stored);
      return clone(stored);
    },

    async compareAndSetWaitlistStatus(id, from, to, patch = {}) {
      const entry = waitlist.get(id);
      if (!entry || entry.status !== from) return null;
      entry.status = to;
      if (patch.offerExpiresAt !== undefined) entry.offerExpiresAt = patch.offerExpiresAt;
      if (patch.expiredAt !== undefined) entry.expiredAt = patch.expiredAt;
      if (patch.acceptedBookingId !== undefined) entry.acceptedBookingId = patch.acceptedBookingId;
      return clone(entry);
    },
  };
}
