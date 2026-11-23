import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateRefund,
  FULL_REFUND_MS,
  HALF_REFUND_MS,
  REFUND_PERCENT,
} from "../src/domain/refundPolicy.js";
import { DAY_MS } from "../src/domain/timings.js";

const NOW = "2026-01-10T12:00:00.000Z";
const startsIn = (ms) => new Date(Date.parse(NOW) + ms).toISOString();

function refundAt(ms, amountCents = 1_000_000) {
  return calculateRefund({ amountCents, startsAt: startsIn(ms), now: NOW });
}

test("S09: exactly 7 days before the event gets 100%", () => {
  assert.equal(FULL_REFUND_MS, 7 * DAY_MS);
  const result = refundAt(7 * DAY_MS);
  assert.equal(result.percent, REFUND_PERCENT.FULL);
  assert.equal(result.refundCents, 1_000_000);
});

test("S09: 6 days 23 hours before the event gets 50%", () => {
  const result = refundAt(7 * DAY_MS - 60 * 60 * 1000);
  assert.equal(result.percent, REFUND_PERCENT.HALF);
  assert.equal(result.refundCents, 500_000);
});

test("S09: exactly 2 days before the event gets 50%", () => {
  assert.equal(HALF_REFUND_MS, 2 * DAY_MS);
  const result = refundAt(2 * DAY_MS);
  assert.equal(result.percent, REFUND_PERCENT.HALF);
  assert.equal(result.refundCents, 500_000);
});

test("S09: 1 day 23 hours before the event gets 0%", () => {
  const result = refundAt(2 * DAY_MS - 60 * 60 * 1000);
  assert.equal(result.percent, REFUND_PERCENT.NONE);
  assert.equal(result.refundCents, 0);
});

test("S09: money stays in whole cents (floor, not round)", () => {
  const result = refundAt(7 * DAY_MS, 101);
  assert.equal(result.refundCents, 101);
  const half = refundAt(2 * DAY_MS, 101);
  assert.equal(half.refundCents, 50); // 50.5 -> 50
});

test("S09: a started event throws EVENT_STARTED, including exactly at start", () => {
  assert.throws(
    () => refundAt(0),
    (err) => err.code === "EVENT_STARTED",
  );
  assert.throws(
    () => refundAt(-DAY_MS),
    (err) => err.code === "EVENT_STARTED",
  );
});

test("S09: bad input is VALIDATION and the function is pure", () => {
  assert.throws(
    () => calculateRefund({ amountCents: 10.5, startsAt: startsIn(DAY_MS), now: NOW }),
    (err) => err.code === "VALIDATION",
  );
  assert.throws(
    () => calculateRefund({ amountCents: 100, startsAt: "nope", now: NOW }),
    (err) => err.code === "VALIDATION",
  );

  const input = Object.freeze({ amountCents: 1000, startsAt: startsIn(DAY_MS), now: NOW });
  const a = calculateRefund(input);
  const b = calculateRefund(input);
  assert.deepEqual(a, b);
});
