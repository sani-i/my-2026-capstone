import { fail } from "./errors.js";
import { newId, newReference } from "./ids.js";
import { Queue } from "./waitlistQueue.js";

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

function assertWholeCents(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail("VALIDATION", `${label} must be a whole number of cents (integer >= 0)`);
  }
  return value;
}

function assertPositiveInt(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    fail("VALIDATION", `${label} must be a positive integer`);
  }
  return value;
}

function assertQuantity(value) {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    fail("VALIDATION", "quantity must be an integer between 1 and 10");
  }
  return value;
}

function getEvent(store, eventId) {
  const event = store.events.get(eventId);
  if (!event) fail("NOT_FOUND", `event not found: ${eventId}`);
  return event;
}

function getTier(store, tierId) {
  const tier = store.tiers.get(tierId);
  if (!tier) fail("NOT_FOUND", `tier not found: ${tierId}`);
  return tier;
}

function getBooking(store, bookingId) {
  const booking = store.bookings.get(bookingId);
  if (!booking) fail("NOT_FOUND", `booking not found: ${bookingId}`);
  return booking;
}

/**
 * Create an in-memory store for the domain.
 * @returns {{
 *   events: Map<string, any>,
 *   tiers: Map<string, any>,
 *   bookings: Map<string, any>,
 *   bookingsByReference: Map<string, any>,
 *   waitlistsByTier: Map<string, Queue>
 * }}
 */
export function createStore() {
  return {
    events: new Map(),
    tiers: new Map(),
    bookings: new Map(),
    bookingsByReference: new Map(),
    waitlistsByTier: new Map(),
  };
}

/**
 * Create an event.
 * @param {ReturnType<typeof createStore>} store
 * @param {{ title: string, city?: string, venue?: string, startsAt?: string }} input
 */
export function createEvent(store, input) {
  assertObject(store, "store");
  assertObject(input, "input");
  const title = assertNonEmptyString(input.title, "title");
  const city = input.city === undefined ? "" : assertNonEmptyString(input.city, "city");
  const venue = input.venue === undefined ? "" : assertNonEmptyString(input.venue, "venue");
  const startsAt =
    input.startsAt === undefined ? "" : assertNonEmptyString(input.startsAt, "startsAt");

  const event = {
    id: newId(),
    title,
    city,
    venue,
    startsAt,
    tierIds: [],
  };
  store.events.set(event.id, event);
  return event;
}

/**
 * Add a ticket tier to an event.
 * @param {ReturnType<typeof createStore>} store
 * @param {{ eventId: string, name: string, priceCents: number, capacity: number }} input
 */
export function addTier(store, input) {
  assertObject(store, "store");
  assertObject(input, "input");
  const eventId = assertNonEmptyString(input.eventId, "eventId");
  const name = assertNonEmptyString(input.name, "name");
  const priceCents = assertWholeCents(input.priceCents, "priceCents");
  const capacity = assertPositiveInt(input.capacity, "capacity");

  const event = getEvent(store, eventId);
  const tier = {
    id: newId(),
    eventId,
    name,
    priceCents,
    capacity,
    sold: 0,
  };
  store.tiers.set(tier.id, tier);
  event.tierIds.push(tier.id);
  if (!store.waitlistsByTier.has(tier.id)) {
    store.waitlistsByTier.set(tier.id, new Queue());
  }
  return tier;
}

/**
 * Book 1-10 tickets from one tier.
 * If there are not enough seats, throws SOLD_OUT and changes nothing.
 * @param {ReturnType<typeof createStore>} store
 * @param {{ tierId: string, userName: string, quantity: number }} input
 */
export function bookTickets(store, input) {
  assertObject(store, "store");
  assertObject(input, "input");
  const tierId = assertNonEmptyString(input.tierId, "tierId");
  const userName = assertNonEmptyString(input.userName, "userName");
  const quantity = assertQuantity(input.quantity);

  const tier = getTier(store, tierId);
  const remaining = tier.capacity - tier.sold;
  if (quantity > remaining) {
    fail(
      "SOLD_OUT",
      `not enough seats: requested ${quantity}, only ${remaining} left in tier "${tier.name}"`,
    );
  }

  // All validation passed; mutate state.
  tier.sold += quantity;
  const booking = {
    id: newId(),
    reference: newReference(),
    tierId,
    eventId: tier.eventId,
    userName,
    quantity,
    amountCents: tier.priceCents * quantity,
    status: "confirmed",
    createdAt: new Date().toISOString(),
  };
  store.bookings.set(booking.id, booking);
  store.bookingsByReference.set(booking.reference, booking);
  return booking;
}

/**
 * Cancel a booking and release its seats. Cancelling twice is an error.
 * @param {ReturnType<typeof createStore>} store
 * @param {string} bookingId
 */
export function cancelBooking(store, bookingId) {
  assertObject(store, "store");
  const id = assertNonEmptyString(bookingId, "bookingId");
  const booking = getBooking(store, id);
  if (booking.status === "cancelled") {
    fail("VALIDATION", `booking already cancelled: ${booking.reference}`);
  }

  const tier = getTier(store, booking.tierId);
  tier.sold -= booking.quantity;
  if (tier.sold < 0) tier.sold = 0; // defensive; should not happen
  booking.status = "cancelled";
  booking.cancelledAt = new Date().toISOString();
  return booking;
}

/**
 * Find a booking by its reference code in O(1).
 * @param {ReturnType<typeof createStore>} store
 * @param {string} reference
 */
export function findBookingByReference(store, reference) {
  assertObject(store, "store");
  const ref = assertNonEmptyString(reference, "reference");
  const booking = store.bookingsByReference.get(ref);
  if (!booking) fail("NOT_FOUND", `booking not found for reference: ${ref}`);
  return booking;
}

/**
 * Join the FIFO waitlist for a sold-out tier.
 * @param {ReturnType<typeof createStore>} store
 * @param {{ tierId: string, userName: string }} input
 */
export function joinWaitlist(store, input) {
  assertObject(store, "store");
  assertObject(input, "input");
  const tierId = assertNonEmptyString(input.tierId, "tierId");
  const userName = assertNonEmptyString(input.userName, "userName");
  getTier(store, tierId); // ensures tier exists

  let queue = store.waitlistsByTier.get(tierId);
  if (!queue) {
    queue = new Queue();
    store.waitlistsByTier.set(tierId, queue);
  }
  const entry = { id: newId(), tierId, userName, joinedAt: new Date().toISOString() };
  queue.enqueue(entry);
  return entry;
}
