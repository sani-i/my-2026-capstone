import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/http/app.js";
import { createMemoryRepository } from "../src/repositories/memory.js";
import { createEventService } from "../src/services/eventService.js";
import { createBookingService } from "../src/services/bookingService.js";
import { createAuthService } from "../src/services/authService.js";
import { createMockPaymentGateway } from "../src/lib/mockPaymentGateway.js";
import { registerApiRoutes } from "../src/http/routes.js";
import { registerAuthRoutes } from "../src/routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.resolve(__dirname, "../public");

export async function withApi(run, { paymentGateway: customGateway } = {}) {
  const repo = createMemoryRepository();
  const paymentGateway = customGateway || createMockPaymentGateway();
  const eventService = createEventService(repo);
  const bookingService = createBookingService(repo, paymentGateway);
  const authService = createAuthService(repo);

  const { server } = createApp({
    publicDir,
    registerRoutes(router, helpers) {
      registerAuthRoutes(router, { authService });
      registerApiRoutes(router, { ...helpers, eventService, bookingService });
    },
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ baseUrl, repo });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

export async function request(baseUrl, method, pathname, { body, token, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { res, json, text };
}

export async function signup(baseUrl, email, role = "attendee", password = "password123") {
  const result = await request(baseUrl, "POST", "/api/auth/signup", {
    body: { email, password, role },
  });
  return { ...result, token: result.json?.token, user: result.json?.user };
}

export async function login(baseUrl, email, password) {
  const result = await request(baseUrl, "POST", "/api/auth/login", {
    body: { email, password },
  });
  return { ...result, token: result.json?.token, user: result.json?.user };
}

export async function seedEvent(baseUrl, token, { capacity = 100, priceCents = 500000 } = {}) {
  const created = await request(baseUrl, "POST", "/api/events", {
    token,
    body: {
      title: "Lagos Tech Meetup",
      city: "Lagos",
      venue: "Landmark Centre",
      startsAt: "2026-12-05T17:00:00Z",
    },
  });
  const eventId = created.json.id;
  const tier = await request(baseUrl, "POST", `/api/events/${eventId}/tiers`, {
    token,
    body: { name: "General", priceCents, capacity },
  });
  await request(baseUrl, "POST", `/api/events/${eventId}/publish`, { token });
  return { eventId, tierId: tier.json.id };
}
