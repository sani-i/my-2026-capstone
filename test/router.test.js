import test from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "../src/http/router.js";

test("router matches method and path", async () => {
  const router = createRouter();
  let called = false;
  router.add("GET", "/health", () => {
    called = true;
  });
  const match = router.match("GET", "/health");
  assert.ok(match);
  await match.handler();
  assert.equal(called, true);
});

test("router extracts :params", () => {
  const router = createRouter();
  router.add("GET", "/api/events/:id/bookings/:bookingId", () => {});
  const match = router.match("GET", "/api/events/ev1/bookings/bk2");
  assert.ok(match);
  assert.deepEqual(match.params, { id: "ev1", bookingId: "bk2" });
});

test("router returns null for unknown route", () => {
  const router = createRouter();
  router.add("GET", "/health", () => {});
  assert.equal(router.match("POST", "/health"), null);
  assert.equal(router.match("GET", "/missing"), null);
});
