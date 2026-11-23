/**
 * A controllable clock. Production code calls now()/nowMs()/nowIso() instead
 * of new Date(), so tests can move time forward without sleeping.
 */
function toTime(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) throw new TypeError("Invalid date");
    return ms;
  }
  if (typeof value === "number" || typeof value === "string") {
    const ms = typeof value === "number" ? value : Date.parse(value);
    if (Number.isNaN(ms)) throw new TypeError(`Invalid date: ${value}`);
    return ms;
  }
  throw new TypeError("A Date, timestamp or ISO date string is required");
}

export function createClock(initial = new Date()) {
  let currentMs = toTime(initial);

  return {
    /** A copy, so callers cannot mutate the clock's internal date. */
    now() {
      return new Date(currentMs);
    },
    nowMs() {
      return currentMs;
    },
    nowIso() {
      return new Date(currentMs).toISOString();
    },
    setNow(value) {
      currentMs = toTime(value);
      return new Date(currentMs);
    },
    advance(ms) {
      if (!Number.isFinite(ms)) throw new TypeError("advance requires a number of milliseconds");
      currentMs += ms;
      return new Date(currentMs);
    },
    reset(value = initial) {
      currentMs = toTime(value);
      return new Date(currentMs);
    },
  };
}
