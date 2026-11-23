import { fail } from "./errors.js";
import { DAY_MS } from "./timings.js";

export const FULL_REFUND_MS = 7 * DAY_MS;
export const HALF_REFUND_MS = 2 * DAY_MS;

export const REFUND_PERCENT = Object.freeze({ FULL: 100, HALF: 50, NONE: 0 });

function timeOf(value, label) {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) fail("VALIDATION", `${label} must be a valid date`);
    return ms;
  }
  if (typeof value === "string" || typeof value === "number") {
    const ms = typeof value === "number" ? value : Date.parse(value);
    if (Number.isNaN(ms)) fail("VALIDATION", `${label} must be a valid date`);
    return ms;
  }
  fail("VALIDATION", `${label} must be a valid date`);
}

/**
 * Pure refund calculation. The exact boundary belongs to the better tier:
 * 7 days or more -> 100%, 2 days or more -> 50%, otherwise 0%.
 * Money stays in whole cents: the percentage is floored.
 *
 * @returns {{refundCents:number, percent:number, amountCents:number,
 *            startsAt:string, now:string, msUntilStart:number}}
 */
export function calculateRefund({ amountCents, startsAt, now } = {}) {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    fail("VALIDATION", "amountCents must be a whole number of cents (integer >= 0)");
  }
  const startMs = timeOf(startsAt, "startsAt");
  const nowMs = timeOf(now, "now");
  const msUntilStart = startMs - nowMs;

  if (msUntilStart <= 0) {
    fail("EVENT_STARTED", "The event has already started; no refund is available");
  }

  const percent =
    msUntilStart >= FULL_REFUND_MS
      ? REFUND_PERCENT.FULL
      : msUntilStart >= HALF_REFUND_MS
        ? REFUND_PERCENT.HALF
        : REFUND_PERCENT.NONE;

  return {
    refundCents: Math.floor((amountCents * percent) / 100),
    percent,
    amountCents,
    startsAt: new Date(startMs).toISOString(),
    now: new Date(nowMs).toISOString(),
    msUntilStart,
  };
}
