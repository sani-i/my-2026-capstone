import test from "node:test";
import assert from "node:assert/strict";
import { withApi, request, signup, seedEvent } from "./helpers.js";
import { createClock } from "../src/lib/clock.js";
import { createMockPaymentGateway } from "../src/lib/mockPaymentGateway.js";
import { DAY_MS } from "../src/domain/timings.js";

const NOW = "2026-01-01T12:00:00.000Z";
const FAR_START = "2026-06-01T12:00:00.000Z";

function makeClock() {
  return createClock(NOW);
}

async function paidFixture(baseUrl, options = {}) {
  const organizer = await signup(baseUrl, "org@example.com", "organizer");
  const attendee = await signup(baseUrl, "ada@example.com", "attendee");
  const { eventId, tierId } = await seedEvent(baseUrl, organizer.token, {
    capacity: options.capacity ?? 5,
    priceCents: options.priceCents ?? 500000,
    startsAt: options.startsAt ?? FAR_START,
  });
  const booked = await request(baseUrl, "POST", "/api/bookings", {
    token: attendee.token,
    body: { tierId, quantity: options.quantity ?? 1 },
  });
  assert.equal(booked.res.status, 201);
  const paid = await request(baseUrl, "POST", `/api/bookings/${booked.json.reference}/pay`, {
    token: attendee.token,
    body: { paymentToken: "tok_success" },
  });
  assert.equal(paid.res.status, 200);
  return { organizer, attendee, eventId, tierId, reference: booked.json.reference, paid: paid.json };
}

async function soldOf(repo, tierId) {
  return (await repo.getTierById(tierId)).sold;
}

test("S09: 10 days before the event a paid cancellation refunds 100% once", async () => {
  const clock = makeClock();
  await withApi(async ({ baseUrl, repo }) => {
    const fx = await paidFixture(baseUrl);
    const quote = await request(baseUrl, "GET", `/api/bookings/${fx.reference}/cancel-quote`, {
      token: fx.attendee.token,
    });
    assert.equal(quote.res.status, 200);
    assert.equal(quote.json.percent, 100);
    assert.equal(quote.json.refundCents, 500000);

    assert.equal(await soldOf(repo, fx.tierId), 1);
    const cancel = await request(baseUrl, "POST", `/api/bookings/${fx.reference}/cancel`, {
      token: fx.attendee.token,
    });
    assert.equal(cancel.res.status, 200);
    assert.equal(cancel.json.status, "refunded");
    assert.equal(cancel.json.refundCents, 500000);
    assert.ok(cancel.json.refundId);
    assert.equal(await soldOf(repo, fx.tierId), 0);
  }, { clock });
});

test("S09: 3 days before the event refunds 50%, 1 day before refunds 0% but frees seats", async () => {
  for (const [days, expectedPercent, expectedRefund] of [
    [3, 50, 250000],
    [1, 0, 0],
  ]) {
    const clock = makeClock();
    await withApi(async ({ baseUrl, repo }) => {
      const startsAt = new Date(Date.parse(NOW) + days * DAY_MS).toISOString();
      const fx = await paidFixture(baseUrl, { startsAt });
      const cancel = await request(baseUrl, "POST", `/api/bookings/${fx.reference}/cancel`, {
        token: fx.attendee.token,
      });
      assert.equal(cancel.res.status, 200);
      assert.equal(cancel.json.refundCents, expectedRefund);
      assert.equal(cancel.json.percent ?? (expectedRefund / 500000) * 100, expectedPercent);
      assert.equal(cancel.json.status, "refunded");
      assert.equal(await soldOf(repo, fx.tierId), 0);
    }, { clock });
  }
});

test("S09: cancelling twice is rejected, refunds once and releases seats once", async () => {
  const clock = makeClock();
  const base = createMockPaymentGateway();
  let refundCalls = 0;
  const paymentGateway = {
    charge: (args) => base.charge(args),
    refund: (args) => {
      refundCalls += 1;
      return base.refund(args);
    },
  };

  await withApi(async ({ baseUrl, repo }) => {
    const fx = await paidFixture(baseUrl);
    const first = await request(baseUrl, "POST", `/api/bookings/${fx.reference}/cancel`, {
      token: fx.attendee.token,
    });
    assert.equal(first.res.status, 200);

    const second = await request(baseUrl, "POST", `/api/bookings/${fx.reference}/cancel`, {
      token: fx.attendee.token,
    });
    assert.equal(second.res.status, 409);
    assert.equal(second.json.error.code, "INVALID_STATE");
    assert.equal(refundCalls, 1);
    assert.equal(await soldOf(repo, fx.tierId), 0);
  }, { clock, paymentGateway });
});

test("S09: two simultaneous cancels: exactly one wins and seats are released once", async () => {
  const clock = makeClock();
  await withApi(async ({ baseUrl, repo }) => {
    const fx = await paidFixture(baseUrl, { capacity: 2, quantity: 2 });
    const [a, b] = await Promise.all([
      request(baseUrl, "POST", `/api/bookings/${fx.reference}/cancel`, { token: fx.attendee.token }),
      request(baseUrl, "POST", `/api/bookings/${fx.reference}/cancel`, { token: fx.attendee.token }),
    ]);
    const statuses = [a.res.status, b.res.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    assert.equal(await soldOf(repo, fx.tierId), 0);
  }, { clock });
});

test("S09: cancelling after the event started is EVENT_STARTED and keeps seats sold", async () => {
  const clock = makeClock();
  await withApi(async ({ baseUrl, repo }) => {
    const startsAt = new Date(Date.parse(NOW) - DAY_MS).toISOString();
    const fx = await paidFixture(baseUrl, { startsAt });
    const cancel = await request(baseUrl, "POST", `/api/bookings/${fx.reference}/cancel`, {
      token: fx.attendee.token,
    });
    assert.equal(cancel.res.status, 409);
    assert.equal(cancel.json.error.code, "EVENT_STARTED");
    assert.equal(await soldOf(repo, fx.tierId), 1);
  }, { clock });
});

test("S09: a different attendee cannot read the cancellation quote", async () => {
  const clock = makeClock();
  await withApi(async ({ baseUrl }) => {
    const fx = await paidFixture(baseUrl);
    const other = await signup(baseUrl, "mallory@example.com", "attendee");
    const quote = await request(baseUrl, "GET", `/api/bookings/${fx.reference}/cancel-quote`, {
      token: other.token,
    });
    assert.equal(quote.res.status, 403);
    assert.equal(quote.json.error.code, "FORBIDDEN");
  }, { clock });
});
