import test from "node:test";
import assert from "node:assert/strict";
import {
  addTier,
  bookTickets,
  cancelBooking,
  createEvent,
  createStore,
  findBookingByReference,
  joinWaitlist,
  listEventSummaries,
  publishEvent,
  unpublishEvent,
} from "../src/domain/inventory.js";

function expectDomainError(fn, code) {
  assert.throws(fn, (err) => {
    assert.equal(err?.name, "DomainError");
    assert.equal(err?.code, code);
    return true;
  });
}

// S02
test("S02: create event with title, city, venue, valid date -> draft with new id, not on public list", () => {
  const store = createStore();
  const event = createEvent(store, {
    title: "Tech Meetup",
    city: "Lagos",
    venue: "Hall A",
    startsAt: "2026-06-01T10:00:00Z",
  });
  assert.ok(event.id);
  assert.equal(event.status, "draft");
  assert.equal(event.title, "Tech Meetup");
  const publicList = listEventSummaries(store, { publishedOnly: true });
  assert.equal(publicList.length, 0);
});

test("S02: missing title or city, or date not real -> VALIDATION and nothing saved", () => {
  const store = createStore();
  expectDomainError(
    () => createEvent(store, { title: "", city: "Lagos", venue: "Hall", startsAt: "2026-06-01T10:00:00Z" }),
    "VALIDATION",
  );
  expectDomainError(
    () => createEvent(store, { title: "Event", city: "", venue: "Hall", startsAt: "2026-06-01T10:00:00Z" }),
    "VALIDATION",
  );
  expectDomainError(
    () => createEvent(store, { title: "Event", city: "Lagos", venue: "Hall", startsAt: "not-a-date" }),
    "VALIDATION",
  );
  assert.equal(store.events.size, 0);
});

// S03
test("S03: add tier General at 500000 kobo capacity 100 -> 0 sold, 100 seats left", () => {
  const store = createStore();
  const event = createEvent(store, { title: "E", city: "Lagos", venue: "V", startsAt: "2026-06-01T10:00:00Z" });
  const tier = addTier(store, { eventId: event.id, name: "General", priceCents: 500000, capacity: 100 });
  assert.equal(tier.sold, 0);
  assert.equal(tier.capacity, 100);
  assert.equal(tier.capacity - tier.sold, 100);
  assert.equal(tier.priceCents, 500000);
});

test("S03: price not whole number or capacity < 1 -> VALIDATION", () => {
  const store = createStore();
  const event = createEvent(store, { title: "E", city: "Lagos", venue: "V", startsAt: "2026-06-01T10:00:00Z" });
  expectDomainError(() => addTier(store, { eventId: event.id, name: "G", priceCents: 10.5, capacity: 10 }), "VALIDATION");
  expectDomainError(() => addTier(store, { eventId: event.id, name: "G", priceCents: 100, capacity: 0 }), "VALIDATION");
  expectDomainError(() => addTier(store, { eventId: event.id, name: "G", priceCents: 100, capacity: -1 }), "VALIDATION");
});

test("S03: add tier to non-existent event -> NOT_FOUND", () => {
  const store = createStore();
  expectDomainError(() => addTier(store, { eventId: "missing", name: "G", priceCents: 100, capacity: 10 }), "NOT_FOUND");
});

// S04
test("S04: publish draft event with tier -> becomes published and appears in public list", () => {
  const store = createStore();
  const event = createEvent(store, { title: "E", city: "Lagos", venue: "V", startsAt: "2026-06-01T10:00:00Z" });
  addTier(store, { eventId: event.id, name: "G", priceCents: 1000, capacity: 10 });
  publishEvent(store, event.id);
  assert.equal(store.events.get(event.id).status, "published");
  const publicList = listEventSummaries(store, { publishedOnly: true });
  assert.equal(publicList.length, 1);
  assert.equal(publicList[0].id, event.id);
});

test("S04: unpublish published event -> becomes draft and not in public list", () => {
  const store = createStore();
  const event = createEvent(store, { title: "E", city: "Lagos", venue: "V", startsAt: "2026-06-01T10:00:00Z" });
  addTier(store, { eventId: event.id, name: "G", priceCents: 1000, capacity: 10 });
  publishEvent(store, event.id);
  unpublishEvent(store, event.id);
  assert.equal(store.events.get(event.id).status, "draft");
  const publicList = listEventSummaries(store, { publishedOnly: true });
  assert.equal(publicList.length, 0);
});

test("S04: publish event with no tiers -> INVALID_STATE and remains draft", () => {
  const store = createStore();
  const event = createEvent(store, { title: "E", city: "Lagos", venue: "V", startsAt: "2026-06-01T10:00:00Z" });
  expectDomainError(() => publishEvent(store, event.id), "INVALID_STATE");
  assert.equal(store.events.get(event.id).status, "draft");
});

// S06
test("S06: book 2 of 3 seats -> pending booking, whole cents, 1 seat left", () => {
  const store = createStore();
  const event = createEvent(store, { title: "E", city: "Lagos", venue: "V", startsAt: "2026-06-01T10:00:00Z" });
  const tier = addTier(store, { eventId: event.id, name: "G", priceCents: 5000, capacity: 3 });
  publishEvent(store, event.id);
  const booking = bookTickets(store, { tierId: tier.id, userName: "Ada", quantity: 2 });
  assert.equal(booking.status, "pending");
  assert.equal(booking.quantity, 2);
  assert.equal(booking.amountCents, 10000);
  assert.ok(Number.isInteger(booking.amountCents));
  assert.equal(store.tiers.get(tier.id).capacity - store.tiers.get(tier.id).sold, 1);
});

test("S06: 1 seat left, book 2 -> SOLD_OUT and nothing changes", () => {
  const store = createStore();
  const event = createEvent(store, { title: "E", city: "Lagos", venue: "V", startsAt: "2026-06-01T10:00:00Z" });
  const tier = addTier(store, { eventId: event.id, name: "G", priceCents: 5000, capacity: 1 });
  publishEvent(store, event.id);
  const beforeSold = store.tiers.get(tier.id).sold;
  const beforeBookings = store.bookings.size;
  expectDomainError(() => bookTickets(store, { tierId: tier.id, userName: "Bayo", quantity: 2 }), "SOLD_OUT");
  assert.equal(store.tiers.get(tier.id).sold, beforeSold);
  assert.equal(store.bookings.size, beforeBookings);
});

test("S06: quantity 0, negative, fractional or more than 10 -> VALIDATION", () => {
  const store = createStore();
  const event = createEvent(store, { title: "E", city: "Lagos", venue: "V", startsAt: "2026-06-01T10:00:00Z" });
  const tier = addTier(store, { eventId: event.id, name: "G", priceCents: 5000, capacity: 100 });
  expectDomainError(() => bookTickets(store, { tierId: tier.id, userName: "A", quantity: 0 }), "VALIDATION");
  expectDomainError(() => bookTickets(store, { tierId: tier.id, userName: "A", quantity: -1 }), "VALIDATION");
  expectDomainError(() => bookTickets(store, { tierId: tier.id, userName: "A", quantity: 1.5 }), "VALIDATION");
  expectDomainError(() => bookTickets(store, { tierId: tier.id, userName: "A", quantity: 11 }), "VALIDATION");
});

// Error code coverage / edge behavior
test("findBookingByReference returns NOT_FOUND for unknown reference", () => {
  const store = createStore();
  expectDomainError(() => findBookingByReference(store, "BK-NOPE-NOPE"), "NOT_FOUND");
});

test("cancelBooking twice returns VALIDATION", () => {
  const store = createStore();
  const event = createEvent(store, { title: "E", city: "Lagos", venue: "V", startsAt: "2026-06-01T10:00:00Z" });
  const tier = addTier(store, { eventId: event.id, name: "G", priceCents: 1000, capacity: 10 });
  const booking = bookTickets(store, { tierId: tier.id, userName: "Ada", quantity: 1 });
  cancelBooking(store, booking.id);
  expectDomainError(() => cancelBooking(store, booking.id), "VALIDATION");
});

test("joinWaitlist on missing tier returns NOT_FOUND", () => {
  const store = createStore();
  expectDomainError(() => joinWaitlist(store, { tierId: "missing", userName: "Ada" }), "NOT_FOUND");
});
