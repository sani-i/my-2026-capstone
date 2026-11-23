import test from "node:test";
import assert from "node:assert/strict";
import { createClock } from "../src/lib/clock.js";

test("clock: setNow, advance and nowIso control time without real sleeping", () => {
  const clock = createClock("2026-01-01T00:00:00.000Z");
  assert.equal(clock.nowIso(), "2026-01-01T00:00:00.000Z");

  const first = clock.now();
  first.setFullYear(1999);
  // Mutating the returned Date must not change the clock.
  assert.equal(clock.nowIso(), "2026-01-01T00:00:00.000Z");

  clock.advance(60 * 1000);
  assert.equal(clock.nowIso(), "2026-01-01T00:01:00.000Z");

  clock.setNow("2026-03-04T05:06:07.000Z");
  assert.equal(clock.nowMs(), Date.parse("2026-03-04T05:06:07.000Z"));

  clock.reset();
  assert.equal(clock.nowIso(), "2026-01-01T00:00:00.000Z");
});

test("clock rejects invalid dates", () => {
  const clock = createClock("2026-01-01T00:00:00.000Z");
  assert.throws(() => clock.setNow("not-a-date"), TypeError);
  assert.throws(() => clock.advance("five minutes"), TypeError);
});
