import test from "node:test";
import assert from "node:assert/strict";
import { filterEvents, searchEvents, sortEvents } from "../src/domain/eventSearch.js";

function expectDomainError(fn, code) {
  assert.throws(fn, (err) => {
    assert.equal(err?.name, "DomainError");
    assert.equal(err?.code, code);
    return true;
  });
}

function makeSummary(overrides = {}) {
  return {
    id: overrides.id ?? "id-1",
    title: overrides.title ?? "Event",
    city: overrides.city ?? "Lagos",
    venue: overrides.venue ?? "Hall",
    startsAt: overrides.startsAt ?? "2026-06-01T10:00:00Z",
    status: overrides.status ?? "published",
    tiers: overrides.tiers ?? [],
    cheapestPriceCents:
      overrides.cheapestPriceCents !== undefined ? overrides.cheapestPriceCents : null,
    totalRemaining: overrides.totalRemaining ?? 0,
  };
}

// S05 AC1
test("S05: search 'JAZZ' (case-insensitive) returns only matching event by title/venue", () => {
  const summaries = [
    makeSummary({ id: "1", title: "Lagos Tech Meetup", venue: "Hub" }),
    makeSummary({ id: "2", title: "Abuja Jazz Night", venue: "Arena" }),
  ];
  const out = filterEvents(summaries, { q: "JAZZ" });
  assert.deepEqual(out.map((e) => e.title), ["Abuja Jazz Night"]);
});

// S05 AC2
test("S05: filter by city 'lagos' case-insensitively", () => {
  const summaries = [
    makeSummary({ id: "1", title: "A", city: "Lagos" }),
    makeSummary({ id: "2", title: "B", city: "Abuja" }),
  ];
  const out = filterEvents(summaries, { city: "lagos" });
  assert.deepEqual(out.map((e) => e.city), ["Lagos"]);
});

// S05 AC3
test("S05: max price filters by cheapest tier and sorts by price; no-tier events left out of price filter", () => {
  const summaries = [
    makeSummary({ id: "1", title: "Cheap", cheapestPriceCents: 1000, totalRemaining: 5 }),
    makeSummary({ id: "2", title: "Mid", cheapestPriceCents: 3000, totalRemaining: 5 }),
    makeSummary({ id: "3", title: "Expensive", cheapestPriceCents: 9000, totalRemaining: 5 }),
    makeSummary({ id: "4", title: "No Tiers", cheapestPriceCents: null, totalRemaining: 0 }),
  ];
  const out = searchEvents(summaries, { maxPriceCents: 3000 }, "price");
  assert.deepEqual(out.map((e) => e.title), ["Cheap", "Mid"]);
});

// S05 AC4
test("S05: sort by date earliest first; same-day events stay in title order", () => {
  const summaries = [
    makeSummary({ id: "b", title: "Beta", startsAt: "2026-06-01T12:00:00Z" }),
    makeSummary({ id: "a", title: "Alpha", startsAt: "2026-06-01T12:00:00Z" }),
    makeSummary({ id: "c", title: "Charlie", startsAt: "2026-05-01T12:00:00Z" }),
  ];
  const out = sortEvents(summaries, "date");
  assert.deepEqual(out.map((e) => e.title), ["Charlie", "Alpha", "Beta"]);
});

// S05 AC5
test("S05: date-only 'to' includes whole day (5 PM event included for 2026-12-05)", () => {
  const summaries = [
    makeSummary({ id: "1", title: "Evening", startsAt: "2026-12-05T17:00:00Z" }),
    makeSummary({ id: "2", title: "Next Day", startsAt: "2026-12-06T08:00:00Z" }),
  ];
  const out = filterEvents(summaries, { to: "2026-12-05" });
  assert.deepEqual(out.map((e) => e.title), ["Evening"]);
});

// S05 AC6
test("S05: bad date, non-whole price, or unknown sort option -> VALIDATION", () => {
  const summaries = [makeSummary()];
  expectDomainError(() => filterEvents(summaries, { from: "bad-date" }), "VALIDATION");
  expectDomainError(() => filterEvents(summaries, { to: "2026-99-99" }), "VALIDATION");
  expectDomainError(() => filterEvents(summaries, { maxPriceCents: 12.5 }), "VALIDATION");
  expectDomainError(() => filterEvents(summaries, { maxPriceCents: -1 }), "VALIDATION");
  expectDomainError(() => sortEvents(summaries, "popularity"), "VALIDATION");
});

// S05 AC7 / explicit: original list unchanged after filter and sort
test("S05: original list unchanged after filtering and sorting", () => {
  const summaries = [
    makeSummary({ id: "2", title: "B", startsAt: "2026-07-01T00:00:00Z", cheapestPriceCents: 2000 }),
    makeSummary({ id: "1", title: "A", startsAt: "2026-06-01T00:00:00Z", cheapestPriceCents: 1000 }),
  ];
  const snapshot = JSON.parse(JSON.stringify(summaries));
  filterEvents(summaries, { q: "A" });
  sortEvents(summaries, "price");
  searchEvents(summaries, { city: "Lagos" }, "date");
  assert.deepEqual(summaries, snapshot);
});

test("search/sort/filter handle empty list", () => {
  assert.deepEqual(filterEvents([], { q: "x" }), []);
  assert.deepEqual(sortEvents([], "date"), []);
  assert.deepEqual(searchEvents([], { city: "Lagos" }, "price"), []);
});

test("sortEvents by availability puts most seats left first, tie-break by title then id", () => {
  const summaries = [
    makeSummary({ id: "1", title: "A", totalRemaining: 5 }),
    makeSummary({ id: "2", title: "B", totalRemaining: 20 }),
    makeSummary({ id: "3", title: "A", totalRemaining: 20 }),
  ];
  const out = sortEvents(summaries, "availability");
  assert.deepEqual(out.map((e) => e.id), ["3", "2", "1"]);
});
