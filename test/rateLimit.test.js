import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "../src/lib/rateLimit.js";

test("allows up to max attempts per key inside the window", () => {
  let time = 1_000;
  const limiter = createRateLimiter({ max: 2, windowMs: 1_000, now: () => time });

  assert.equal(limiter.consume("1.2.3.4").allowed, true);
  assert.equal(limiter.consume("1.2.3.4").allowed, true);
  const blocked = limiter.consume("1.2.3.4");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterMs, 1_000);
});

test("keys are independent and the window slides", () => {
  let time = 0;
  const limiter = createRateLimiter({ max: 1, windowMs: 100, now: () => time });

  assert.equal(limiter.consume("a").allowed, true);
  assert.equal(limiter.consume("a").allowed, false);
  assert.equal(limiter.consume("b").allowed, true);

  time = 101;
  assert.equal(limiter.consume("a").allowed, true);
  assert.equal(limiter.size(), 2);
});

test("reset clears one key or every key", () => {
  const limiter = createRateLimiter({ max: 1, windowMs: 1_000 });
  limiter.consume("a");
  limiter.consume("b");

  limiter.reset("a");
  assert.equal(limiter.consume("a").allowed, true);
  assert.equal(limiter.consume("b").allowed, false);

  limiter.reset();
  assert.equal(limiter.consume("b").allowed, true);
});

test("rejects invalid configuration", () => {
  assert.throws(() => createRateLimiter({ max: 0 }), /max/);
  assert.throws(() => createRateLimiter({ windowMs: 0 }), /windowMs/);
});
