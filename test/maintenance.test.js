import test from "node:test";
import assert from "node:assert/strict";
import { withApi, request, signup, seedEvent } from "./helpers.js";
import { createClock } from "../src/lib/clock.js";
import { HOLD_MS } from "../src/domain/timings.js";

const NOW = "2026-01-01T12:00:00.000Z";

async function makeBooking(baseUrl, token, tierId, quantity = 1) {
  const booked = await request(baseUrl, "POST", "/api/bookings", {
    token,
    body: { tierId, quantity },
  });
  assert.equal(booked.res.status, 201);
  return booked.json;
}

test("S10: the job cancels expired pending holds, releases seats once, and skips paid bookings", async () => {
  const clock = createClock(NOW);
  await withApi(async ({ baseUrl, repo, maintenance }) => {
    const organizer = await signup(baseUrl, "org@example.com", "organizer");
    const a = await signup(baseUrl, "a@example.com", "attendee");
    const b = await signup(baseUrl, "b@example.com", "attendee");
    const { tierId } = await seedEvent(baseUrl, organizer.token, { capacity: 3 });

    const paid = await makeBooking(baseUrl, a.token, tierId);
    const pay = await request(baseUrl, "POST", `/api/bookings/${paid.reference}/pay`, {
      token: a.token,
      body: { paymentToken: "tok_success" },
    });
    assert.equal(pay.res.status, 200);
    const pending = await makeBooking(baseUrl, b.token, tierId);
    assert.equal((await repo.getTierById(tierId)).sold, 2);

    clock.advance(HOLD_MS + 1000);
    const firstRun = await maintenance.runOnce();
    assert.equal(firstRun.expiredBookings, 1);
    assert.equal((await repo.getBookingByReference(pending.reference)).status, "cancelled");
    assert.equal((await repo.getBookingByReference(paid.reference)).status, "paid");
    assert.equal((await repo.getTierById(tierId)).sold, 1);

    const secondRun = await maintenance.runOnce();
    assert.equal(secondRun.expiredBookings, 0);
    assert.equal((await repo.getTierById(tierId)).sold, 1);
  }, { clock });
});

test("S10: paying an expired hold gives BOOKING_EXPIRED even before the job runs", async () => {
  const clock = createClock(NOW);
  await withApi(async ({ baseUrl, maintenance, repo }) => {
    const organizer = await signup(baseUrl, "org@example.com", "organizer");
    const ada = await signup(baseUrl, "ada@example.com", "attendee");
    const { tierId } = await seedEvent(baseUrl, organizer.token, { capacity: 2 });
    const booking = await makeBooking(baseUrl, ada.token, tierId);

    clock.advance(HOLD_MS + 1);
    const pay = await request(baseUrl, "POST", `/api/bookings/${booking.reference}/pay`, {
      token: ada.token,
      body: { paymentToken: "tok_success" },
    });
    assert.equal(pay.res.status, 409);
    assert.equal(pay.json.error.code, "BOOKING_EXPIRED");

    await maintenance.runOnce();
    assert.equal((await repo.getBookingByReference(booking.reference)).status, "cancelled");
    assert.equal((await repo.getTierById(tierId)).sold, 0);
  }, { clock });
});

test("S10: seats from an expired hold go to the next person on the waitlist", async () => {
  const clock = createClock(NOW);
  await withApi(async ({ baseUrl, repo, maintenance }) => {
    const organizer = await signup(baseUrl, "org@example.com", "organizer");
    const a = await signup(baseUrl, "a@example.com", "attendee");
    const b = await signup(baseUrl, "b@example.com", "attendee");
    const { tierId } = await seedEvent(baseUrl, organizer.token, { capacity: 1 });

    const pending = await makeBooking(baseUrl, a.token, tierId);
    const joined = await request(baseUrl, "POST", "/api/waitlist", {
      token: b.token,
      body: { tierId },
    });
    assert.equal(joined.res.status, 201);
    assert.equal((await repo.getTierById(tierId)).sold, 1);

    clock.advance(HOLD_MS + 1000);
    await maintenance.runOnce();

    assert.equal((await repo.getBookingByReference(pending.reference)).status, "cancelled");
    const bList = await request(baseUrl, "GET", "/api/waitlist", { token: b.token });
    assert.equal(bList.json.entries[0].status, "offered");
    assert.equal((await repo.getTierById(tierId)).sold, 1);
  }, { clock });
});

test("S10: the job can be started and stopped safely", async () => {
  const clock = createClock(NOW);
  await withApi(async ({ maintenance }) => {
    maintenance.start();
    maintenance.start(); // idempotent
    const result = await maintenance.runOnce();
    assert.equal(result.expiredBookings, 0);
    maintenance.stop();
    maintenance.stop(); // idempotent
  }, { clock });
});
