import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/http/app.js";
import { createMemoryRepository } from "../src/repositories/memory.js";
import { createEventService } from "../src/services/eventService.js";
import { createBookingService } from "../src/services/bookingService.js";
import { createMockPaymentGateway } from "../src/lib/mockPaymentGateway.js";
import { registerApiRoutes } from "../src/http/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

async function withApi(run) {
  const repo = createMemoryRepository();
  const paymentGateway = createMockPaymentGateway();
  const eventService = createEventService(repo);
  const bookingService = createBookingService(repo, paymentGateway);

  const { server } = createApp({
    publicDir,
    registerRoutes(router, helpers) {
      registerApiRoutes(router, { ...helpers, eventService, bookingService });
    },
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function request(baseUrl, method, path, { body, userId, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (userId) h["x-user-id"] = userId;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { res, json, text };
}

async function seedEvent(baseUrl, { organizer = "org-1", capacity = 100, priceCents = 500000 } = {}) {
  const created = await request(baseUrl, "POST", "/api/events", {
    userId: organizer,
    body: { title: "Lagos Tech Meetup", city: "Lagos", venue: "Landmark Centre", startsAt: "2026-12-05T17:00:00Z" },
  });
  const eventId = created.json.id;
  const tier = await request(baseUrl, "POST", `/api/events/${eventId}/tiers`, {
    userId: organizer,
    body: { name: "General", priceCents, capacity },
  });
  await request(baseUrl, "POST", `/api/events/${eventId}/publish`, { userId: organizer });
  return { eventId, tierId: tier.json.id };
}

test("Build 4 API flow: create, tier, publish, search, book, pay", async () => {
  await withApi(async (baseUrl) => {
    const { eventId, tierId } = await seedEvent(baseUrl);

    const search = await request(baseUrl, "GET", "/api/events?city=lagos&sort=price");
    assert.equal(search.res.status, 200);
    assert.ok(Array.isArray(search.json.events));
    assert.equal(search.json.events.length, 1);
    assert.equal(search.json.events[0].id, eventId);

    const book = await request(baseUrl, "POST", "/api/bookings", {
      userId: "ada",
      body: { tierId, quantity: 2 },
    });
    assert.equal(book.res.status, 201);
    assert.equal(book.json.status, "pending");
    assert.equal(book.json.amountCents, 1000000);
    assert.ok(book.json.reference);

    const pay = await request(baseUrl, "POST", `/api/bookings/${book.json.reference}/pay`, {
      userId: "ada",
      body: { paymentToken: "tok_success" },
    });
    assert.equal(pay.res.status, 200);
    assert.equal(pay.json.status, "paid");
    assert.equal(pay.json.reference, book.json.reference);
  });
});

test("S07: declined card returns PAYMENT_DECLINED and booking stays pending", async () => {
  await withApi(async (baseUrl) => {
    const { tierId } = await seedEvent(baseUrl);
    const book = await request(baseUrl, "POST", "/api/bookings", { userId: "ada", body: { tierId, quantity: 1 } });
    const ref = book.json.reference;

    const declined = await request(baseUrl, "POST", `/api/bookings/${ref}/pay`, {
      userId: "ada",
      body: { paymentToken: "tok_declined" },
    });
    assert.equal(declined.res.status, 402);
    assert.equal(declined.json.error.code, "PAYMENT_DECLINED");

    const booking = await request(baseUrl, "GET", `/api/bookings/${ref}`, { userId: "ada" });
    assert.equal(booking.json.status, "pending");

    const retry = await request(baseUrl, "POST", `/api/bookings/${ref}/pay`, {
      userId: "ada",
      body: { paymentToken: "tok_success" },
    });
    assert.equal(retry.res.status, 200);
    assert.equal(retry.json.status, "paid");
  });
});

test("S07: paying cancelled booking returns INVALID_TRANSITION", async () => {
  await withApi(async (baseUrl) => {
    const { tierId } = await seedEvent(baseUrl);
    const book = await request(baseUrl, "POST", "/api/bookings", { userId: "ada", body: { tierId, quantity: 1 } });
    const ref = book.json.reference;
    await request(baseUrl, "POST", `/api/bookings/${ref}/cancel`, { userId: "ada" });

    const pay = await request(baseUrl, "POST", `/api/bookings/${ref}/pay`, {
      userId: "ada",
      body: { paymentToken: "tok_success" },
    });
    assert.equal(pay.res.status, 409);
    assert.equal(pay.json.error.code, "INVALID_TRANSITION");
  });
});

test("S07: paying already paid booking is rejected and card not charged twice", async () => {
  await withApi(async (baseUrl) => {
    let charges = 0;
    const repo = createMemoryRepository();
    const paymentGateway = {
      async charge(args) {
        charges += 1;
        return { ok: true, chargeId: `ch_${charges}` };
      },
    };
    const eventService = createEventService(repo);
    const bookingService = createBookingService(repo, paymentGateway);
    const { server } = createApp({
      publicDir,
      registerRoutes(router, helpers) {
        registerApiRoutes(router, { ...helpers, eventService, bookingService });
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
      const { tierId } = await seedEvent(base);
      const book = await request(base, "POST", "/api/bookings", { userId: "ada", body: { tierId, quantity: 1 } });
      const ref = book.json.reference;

      const first = await request(base, "POST", `/api/bookings/${ref}/pay`, { userId: "ada", body: { paymentToken: "tok_success" } });
      assert.equal(first.res.status, 200);
      assert.equal(charges, 1);

      const second = await request(base, "POST", `/api/bookings/${ref}/pay`, { userId: "ada", body: { paymentToken: "tok_success" } });
      assert.equal(second.res.status, 409);
      assert.equal(charges, 1); // not charged again
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

test("booking can only be paid/cancelled/viewed by the person who made it", async () => {
  await withApi(async (baseUrl) => {
    const { tierId } = await seedEvent(baseUrl);
    const book = await request(baseUrl, "POST", "/api/bookings", { userId: "ada", body: { tierId, quantity: 1 } });
    const ref = book.json.reference;

    const view = await request(baseUrl, "GET", `/api/bookings/${ref}`, { userId: "mallory" });
    assert.equal(view.res.status, 403);
    assert.equal(view.json.error.code, "FORBIDDEN");

    const pay = await request(baseUrl, "POST", `/api/bookings/${ref}/pay`, { userId: "mallory", body: { paymentToken: "tok_success" } });
    assert.equal(pay.res.status, 403);

    const cancel = await request(baseUrl, "POST", `/api/bookings/${ref}/cancel`, { userId: "mallory" });
    assert.equal(cancel.res.status, 403);
  });
});

test("errors have consistent shape", async () => {
  await withApi(async (baseUrl) => {
    const res = await request(baseUrl, "GET", "/api/events/does-not-exist");
    assert.equal(res.res.status, 404);
    assert.equal(typeof res.json.error.code, "string");
    assert.equal(typeof res.json.error.message, "string");
  });
});
