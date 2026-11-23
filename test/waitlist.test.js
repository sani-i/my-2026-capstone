import test from "node:test";
import assert from "node:assert/strict";
import { withApi, request, signup, seedEvent } from "./helpers.js";
import { createClock } from "../src/lib/clock.js";
import { OFFER_MS } from "../src/domain/timings.js";

const NOW = "2026-01-01T12:00:00.000Z";

async function soldOutFixture(baseUrl) {
  const organizer = await signup(baseUrl, "org@example.com", "organizer");
  const a = await signup(baseUrl, "a@example.com", "attendee");
  const b = await signup(baseUrl, "b@example.com", "attendee");
  const c = await signup(baseUrl, "c@example.com", "attendee");
  const { tierId } = await seedEvent(baseUrl, organizer.token, { capacity: 1 });

  const booking = await request(baseUrl, "POST", "/api/bookings", {
    token: a.token,
    body: { tierId, quantity: 1 },
  });
  assert.equal(booking.res.status, 201);
  const pay = await request(baseUrl, "POST", `/api/bookings/${booking.json.reference}/pay`, {
    token: a.token,
    body: { paymentToken: "tok_success" },
  });
  assert.equal(pay.res.status, 200);

  for (const user of [b, c]) {
    const joined = await request(baseUrl, "POST", "/api/waitlist", {
      token: user.token,
      body: { tierId },
    });
    assert.equal(joined.res.status, 201);
    assert.equal(joined.json.status, "waiting");
  }
  return { organizer, a, b, c, tierId, reference: booking.json.reference };
}

test("S11: joining a sold-out tier appends to the queue, with the right errors", async () => {
  const clock = createClock(NOW);
  await withApi(async ({ baseUrl }) => {
    const fx = await soldOutFixture(baseUrl);

    const again = await request(baseUrl, "POST", "/api/waitlist", {
      token: fx.b.token,
      body: { tierId: fx.tierId },
    });
    assert.equal(again.res.status, 409);
    assert.equal(again.json.error.code, "ALREADY_ON_WAITLIST");

    const unknown = await request(baseUrl, "POST", "/api/waitlist", {
      token: fx.b.token,
      body: { tierId: "no-such-tier" },
    });
    assert.equal(unknown.res.status, 404);
    assert.equal(unknown.json.error.code, "NOT_FOUND");

    const { tierId: availableTier } = await seedEvent(baseUrl, fx.organizer.token, {
      capacity: 2,
    });
    const notSoldOut = await request(baseUrl, "POST", "/api/waitlist", {
      token: fx.b.token,
      body: { tierId: availableTier },
    });
    assert.equal(notSoldOut.res.status, 409);
    assert.equal(notSoldOut.json.error.code, "NOT_SOLD_OUT");

    const anonymous = await request(baseUrl, "POST", "/api/waitlist", {
      body: { tierId: fx.tierId },
    });
    assert.equal(anonymous.res.status, 401);
  }, { clock });
});

test("S12: a freed seat is held for A, not B or C, and A can accept it", async () => {
  const clock = createClock(NOW);
  await withApi(async ({ baseUrl, repo }) => {
    const fx = await soldOutFixture(baseUrl);
    const cancel = await request(baseUrl, "POST", `/api/bookings/${fx.reference}/cancel`, {
      token: fx.a.token,
    });
    assert.equal(cancel.res.status, 200);

    // A's freed seat is immediately held for the first person in the queue.
    assert.equal((await repo.getTierById(fx.tierId)).sold, 1);
    const bList = await request(baseUrl, "GET", "/api/waitlist", { token: fx.b.token });
    const cList = await request(baseUrl, "GET", "/api/waitlist", { token: fx.c.token });
    assert.equal(bList.json.entries[0].status, "offered");
    assert.ok(bList.json.entries[0].offerExpiresAt);
    assert.equal(cList.json.entries[0].status, "waiting");
    assert.equal(cList.json.entries[0].position, 1);

    const wrongPerson = await request(baseUrl, "POST", `/api/waitlist/${bList.json.entries[0].id}/accept`, {
      token: fx.c.token,
    });
    assert.equal(wrongPerson.res.status, 403);

    const accepted = await request(baseUrl, "POST", `/api/waitlist/${bList.json.entries[0].id}/accept`, {
      token: fx.b.token,
    });
    assert.equal(accepted.res.status, 200);
    assert.equal(accepted.json.entry.status, "accepted");
    assert.equal(accepted.json.booking.status, "pending");
    assert.equal(accepted.json.booking.amountCents, 500000);
    // The seats are still held, now by B's pending booking.
    assert.equal((await repo.getTierById(fx.tierId)).sold, 1);

    const paid = await request(baseUrl, "POST", `/api/bookings/${accepted.json.booking.reference}/pay`, {
      token: fx.b.token,
      body: { paymentToken: "tok_success" },
    });
    assert.equal(paid.res.status, 200);
    assert.equal((await repo.getTierById(fx.tierId)).sold, 1);
  }, { clock });
});

test("S12: an expired offer passes to B, and A's late accept is OFFER_EXPIRED", async () => {
  const clock = createClock(NOW);
  await withApi(async ({ baseUrl, repo, maintenance }) => {
    const fx = await soldOutFixture(baseUrl);
    await request(baseUrl, "POST", `/api/bookings/${fx.reference}/cancel`, { token: fx.a.token });

    const bList = await request(baseUrl, "GET", "/api/waitlist", { token: fx.b.token });
    const offerId = bList.json.entries[0].id;
    clock.advance(OFFER_MS + 1000);

    const result = await maintenance.runOnce();
    assert.equal(result.expiredOffers, 1);

    const late = await request(baseUrl, "POST", `/api/waitlist/${offerId}/accept`, {
      token: fx.b.token,
    });
    assert.equal(late.res.status, 409);
    assert.equal(late.json.error.code, "OFFER_EXPIRED");

    const bAfter = await request(baseUrl, "GET", "/api/waitlist", { token: fx.b.token });
    const cAfter = await request(baseUrl, "GET", "/api/waitlist", { token: fx.c.token });
    assert.equal(bAfter.json.entries[0].status, "expired");
    assert.equal(cAfter.json.entries[0].status, "offered");
    // Net seats held stays at one throughout the hand-off.
    assert.equal((await repo.getTierById(fx.tierId)).sold, 1);

    const cAccept = await request(baseUrl, "POST", `/api/waitlist/${cAfter.json.entries[0].id}/accept`, {
      token: fx.c.token,
    });
    assert.equal(cAccept.res.status, 200);
    assert.equal((await repo.getTierById(fx.tierId)).sold, 1);
  }, { clock });
});

test("S12: two tabs accepting the same offer create only one booking", async () => {
  const clock = createClock(NOW);
  await withApi(async ({ baseUrl, repo }) => {
    const fx = await soldOutFixture(baseUrl);
    await request(baseUrl, "POST", `/api/bookings/${fx.reference}/cancel`, { token: fx.a.token });
    const bList = await request(baseUrl, "GET", "/api/waitlist", { token: fx.b.token });
    const offerId = bList.json.entries[0].id;

    const [a, b] = await Promise.all([
      request(baseUrl, "POST", `/api/waitlist/${offerId}/accept`, { token: fx.b.token }),
      request(baseUrl, "POST", `/api/waitlist/${offerId}/accept`, { token: fx.b.token }),
    ]);
    assert.deepEqual([a.res.status, b.res.status].sort(), [200, 409]);
    const bookings = await repo.listBookingsByUserId(fx.b.user.id);
    assert.equal(bookings.filter((booking) => booking.status !== "cancelled").length, 1);
    assert.equal((await repo.getTierById(fx.tierId)).sold, 1);
  }, { clock });
});
