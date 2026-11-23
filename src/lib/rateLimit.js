/**
 * Tiny in-process rate limiter with a sliding window. No outside packages.
 * The app uses one instance for login and another for check-in, keyed by IP.
 */
export function createRateLimiter({
  max = 10,
  windowMs = 60 * 1000,
  now = () => Date.now(),
} = {}) {
  if (!Number.isInteger(max) || max < 1) throw new TypeError("max must be a positive integer");
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new TypeError("windowMs must be positive");
  if (typeof now !== "function") throw new TypeError("now must be a function");

  const hits = new Map();

  function consume(key) {
    const identity = String(key ?? "unknown");
    const time = now();
    const cutoff = time - windowMs;
    const recent = (hits.get(identity) || []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= max) {
      hits.set(identity, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, recent[0] + windowMs - time),
      };
    }

    recent.push(time);
    hits.set(identity, recent);
    return { allowed: true, remaining: max - recent.length, retryAfterMs: 0 };
  }

  function reset(key) {
    if (key === undefined) hits.clear();
    else hits.delete(String(key));
  }

  return {
    consume,
    reset,
    size: () => hits.size,
    config: Object.freeze({ max, windowMs }),
  };
}
