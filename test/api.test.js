import test from "node:test";
import assert from "node:assert/strict";
import { withApi, request, signup, seedEvent } from "./helpers.js";

async function setupUsers(baseUrl) {
  const organizer = await signup(baseUrl, "org@example.com", "organizer");
  const attendee = await signup(baseUrl, "ada@example.com", "attendee");
  assert.equal(organizer.res.status, 201);
  assert.equal(attendee.res.status, 201);
  return { organizerToken: organizer.token, attendeeToken: attendee.token };
}

test("Build 4 API flow with tokens: create, tier, publish, search, book, pay", async () => {
  await withApi(async ({ baseUrl }) => {
    const { organizerToken, attendeeToken } = await setupUsers(baseUrl);
    const { eventId, tierId } = await seedEvent(baseUrl, organizerToken);

    const search = await request(baseUrl, "GET", "/api/events?city=lagos&sort=price");
    assert.equal(search.res.status, 200);
    assert.ok(Array.isArray(search.json.events));
    assert.equal(search.json.events.length, 1);
    assert.equal(search.json.events[0].id, eventId);

    const book = await request(baseUrl, "POST", "/api/bookings", {
      token: attendeeToken,
      body: { tierId, quantity: 2 },
    });
    assert.equal(book.res.status, 201);
    assert.equal(book.json.status, "pending");
    assert.equal(book.json.amountCents, 1000000);
    assert.ok(book.json.reference);

    const pay = await request(baseUrl, "POST", `/api/bookings/${book.json.reference}/pay`, {
      token: attendeeToken,
      body: { paymentToken: "tok_success" },
    });
    assert.equal(pay.res.status, 200);
    assert.equal(pay.json.status, "paid");
    assert.equal(pay.json.reference, book.json.reference);
  });
});

test("S07: declined card returns PAYMENT_DECLINED and booking stays pending", async () => {
  await withApi(async ({ baseUrl }) => {
    const { organizerToken, attendeeToken } = await setupUsers(baseUrl);
    const { tierId } = await seedEvent(baseUrl, organizerToken);
    const book = await request(baseUrl, "POST", "/api/bookings", {
      token: attendeeToken,
      body: { tierId, quantity: 1 },
    });
    const ref = book.json.reference;

    const declined = await request(baseUrl, "POST", `/api/bookings/${ref}/pay`, {
      token: attendeeToken,
      body: { paymentToken: "tok_declined" },
    });
    assert.equal(declined.res.status, 402);
    assert.equal(declined.json.error.code, "PAYMENT_DECLINED");

    const booking = await request(baseUrl, "GET", `/api/bookings/${ref}`, {
      token: attendeeToken,
    });
    assert.equal(booking.json.status, "pending");

    const retry = await request(baseUrl, "POST", `/api/bookings/${ref}/pay`, {
      token: attendeeToken,
      body: { paymentToken: "tok_success" },
    });
    assert.equal(retry.res.status, 200);
    assert.equal(retry.json.status, "paid");
  });
});

test("S07: paying cancelled booking returns INVALID_TRANSITION", async () => {
  await withApi(async ({ baseUrl }) => {
    const { organizerToken, attendeeToken } = await setupUsers(baseUrl);
    const { tierId } = await seedEvent(baseUrl, organizerToken);
    const book = await request(baseUrl, "POST", "/api/bookings", {
      token: attendeeToken,
      body: { tierId, quantity: 1 },
    });
    const ref = book.json.reference;
    await request(baseUrl, "POST", `/api/bookings/${ref}/cancel`, { token: attendeeToken });

    const pay = await request(baseUrl, "POST", `/api/bookings/${ref}/pay`, {
      token: attendeeToken,
      body: { paymentToken: "tok_success" },
    });
    assert.equal(pay.res.status, 409);
    assert.equal(pay.json.error.code, "INVALID_TRANSITION");
  });
});

test("S07: paying already paid booking is rejected and card not charged twice", async () => {
  let charges = 0;
  const paymentGateway = {
    async charge() {
      charges += 1;
      return { ok: true, chargeId: `ch_${charges}` };
    },
  };
  await withApi(
    async ({ baseUrl }) => {
      const { organizerToken, attendeeToken } = await setupUsers(baseUrl);
      const { tierId } = await seedEvent(baseUrl, organizerToken);
      const book = await request(baseUrl, "POST", "/api/bookings", {
        token: attendeeToken,
        body: { tierId, quantity: 1 },
      });
      const ref = book.json.reference;

      const first = await request(baseUrl, "POST", `/api/bookings/${ref}/pay`, {
        token: attendeeToken,
        body: { paymentToken: "tok_success" },
      });
      assert.equal(first.res.status, 200);
      assert.equal(charges, 1);

      const second = await request(baseUrl, "POST", `/api/bookings/${ref}/pay`, {
        token: attendeeToken,
        body: { paymentToken: "tok_success" },
      });
      assert.equal(second.res.status, 409);
      assert.equal(charges, 1);
    },
    { paymentGateway },
  );
});

test("booking can only be paid/cancelled/viewed by the person who made it", async () => {
  await withApi(async ({ baseUrl }) => {
    const { organizerToken, attendeeToken } = await setupUsers(baseUrl);
    const other = await signup(baseUrl, "mallory@example.com", "attendee");
    const { tierId } = await seedEvent(baseUrl, organizerToken);
    const book = await request(baseUrl, "POST", "/api/bookings", {
      token: attendeeToken,
      body: { tierId, quantity: 1 },
    });
    const ref = book.json.reference;

    const view = await request(baseUrl, "GET", `/api/bookings/${ref}`, { token: other.token });
    assert.equal(view.res.status, 403);
    assert.equal(view.json.error.code, "FORBIDDEN");

    const pay = await request(baseUrl, "POST", `/api/bookings/${ref}/pay`, {
      token: other.token,
      body: { paymentToken: "tok_success" },
    });
    assert.equal(pay.res.status, 403);

    const cancel = await request(baseUrl, "POST", `/api/bookings/${ref}/cancel`, {
      token: other.token,
    });
    assert.equal(cancel.res.status, 403);
  });
});

test("errors have consistent shape", async () => {
  await withApi(async ({ baseUrl }) => {
    const res = await request(baseUrl, "GET", "/api/events/does-not-exist");
    assert.equal(res.res.status, 404);
    assert.equal(typeof res.json.error.code, "string");
    assert.equal(typeof res.json.error.message, "string");
  });
});
