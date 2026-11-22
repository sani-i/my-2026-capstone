import { newId, newReference } from "../domain/ids.js";

function clone(value) {
  return value === undefined ? value : structuredClone(value);
}

/**
 * In-memory repository. Async methods for events, tiers and bookings.
 * Services receive the repository as an argument; they do not import it.
 */
export function createMemoryRepository() {
  const events = new Map();
  const tiers = new Map();
  const bookings = new Map();
  const bookingsByReference = new Map();

  return {
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
        createdAt: new Date().toISOString(),
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
  };
}
