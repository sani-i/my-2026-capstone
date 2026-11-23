import test from "node:test";
import assert from "node:assert/strict";
import { withApi, request, signup, login, seedEvent } from "./helpers.js";
import { signToken, verifyToken } from "../src/lib/token.js";
import { verifyPassword } from "../src/lib/password.js";

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

test("S01: signup creates an attendee by default, hashes the password and returns a token", async () => {
  await withApi(async ({ baseUrl, repo }) => {
    const result = await signup(baseUrl, "new@example.com", undefined, "password123");
    assert.equal(result.res.status, 201);
    assert.equal(result.user.role, "attendee");
    assert.ok(result.token);
    assert.doesNotMatch(result.text, /password123/);

    const stored = await repo.getUserByEmail("new@example.com");
    assert.ok(stored.passwordHash.startsWith("scrypt$"));
    assert.notEqual(stored.passwordHash, "password123");
    assert.equal(verifyPassword("password123", stored.passwordHash), true);
    assert.equal(verifyPassword("wrong-password", stored.passwordHash), false);

    const me = await request(baseUrl, "GET", "/api/auth/me", { token: result.token });
    assert.equal(me.res.status, 200);
    assert.equal(me.json.email, "new@example.com");
    assert.equal(me.json.role, "attendee");
    assert.doesNotMatch(me.text, /password/i);
  });
});

test("S01: signing up with a used email gives EMAIL_TAKEN; short password gives VALIDATION", async () => {
  await withApi(async ({ baseUrl }) => {
    const first = await signup(baseUrl, "taken@example.com", "organizer");
    assert.equal(first.res.status, 201);

    const duplicate = await signup(baseUrl, "TAKEN@example.com", "attendee");
    assert.equal(duplicate.res.status, 409);
    assert.equal(duplicate.json.error.code, "EMAIL_TAKEN");

    const short = await signup(baseUrl, "short@example.com", "attendee", "short");
    assert.equal(short.res.status, 400);
    assert.equal(short.json.error.code, "VALIDATION");

    const badRole = await signup(baseUrl, "badrole@example.com", "admin");
    assert.equal(badRole.res.status, 400);
    assert.equal(badRole.json.error.code, "VALIDATION");
  });
});

test("S01: login returns a token; wrong password and unknown email give the same error", async () => {
  await withApi(async ({ baseUrl }) => {
    await signup(baseUrl, "login@example.com", "attendee", "password123");

    const good = await login(baseUrl, "login@example.com", "password123");
    assert.equal(good.res.status, 200);
    assert.ok(good.token);

    const wrongPassword = await login(baseUrl, "login@example.com", "nope-password");
    const unknownEmail = await login(baseUrl, "missing@example.com", "nope-password");
    assert.equal(wrongPassword.res.status, 401);
    assert.equal(unknownEmail.res.status, 401);
    assert.equal(wrongPassword.json.error.code, "INVALID_CREDENTIALS");
    assert.equal(unknownEmail.json.error.code, "INVALID_CREDENTIALS");
    assert.equal(wrongPassword.json.error.message, unknownEmail.json.error.message);
    assert.doesNotMatch(good.text, /password123/);
  });
});

test("S01: a missing, edited, expired or non-HS256 token is UNAUTHENTICATED", async () => {
  await withApi(async ({ baseUrl }) => {
    const user = await signup(baseUrl, "tokens@example.com", "attendee");
    assert.equal(user.res.status, 201);

    const missing = await request(baseUrl, "GET", "/api/auth/me");
    assert.equal(missing.res.status, 401);
    assert.equal(missing.json.error.code, "UNAUTHENTICATED");

    const garbage = await request(baseUrl, "GET", "/api/auth/me", { token: "not-a-token" });
    assert.equal(garbage.res.status, 401);
    assert.equal(garbage.json.error.code, "UNAUTHENTICATED");

    const edited = `${user.token.slice(0, -2)}xx`;
    const tampered = await request(baseUrl, "GET", "/api/auth/me", { token: edited });
    assert.equal(tampered.res.status, 401);
    assert.equal(tampered.json.error.code, "UNAUTHENTICATED");

    const expired = signToken(
      { sub: user.user.id, email: user.user.email, role: user.user.role },
      { expiresInSeconds: -60 },
    );
    const expiredRes = await request(baseUrl, "GET", "/api/auth/me", { token: expired });
    assert.equal(expiredRes.res.status, 401);
    assert.equal(expiredRes.json.error.code, "UNAUTHENTICATED");

    const algNone = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ sub: user.user.id, role: "attendee" })}.x`;
    const algNoneRes = await request(baseUrl, "GET", "/api/auth/me", { token: algNone });
    assert.equal(algNoneRes.res.status, 401);
    assert.equal(algNoneRes.json.error.code, "UNAUTHENTICATED");

    // The x-user-id header must no longer be accepted as identity.
    const oldHeader = await request(baseUrl, "GET", "/api/auth/me", {
      headers: { "x-user-id": user.user.id },
    });
    assert.equal(oldHeader.res.status, 401);
    assert.equal(oldHeader.json.error.code, "UNAUTHENTICATED");

    assert.throws(() => verifyToken(algNone), { code: "UNAUTHENTICATED" });
  });
});

test("S13: an attendee cannot create events or open the organizer dashboard", async () => {
  await withApi(async ({ baseUrl }) => {
    const attendee = await signup(baseUrl, "plain@example.com", "attendee");

    const create = await request(baseUrl, "POST", "/api/events", {
      token: attendee.token,
      body: {
        title: "Nope",
        city: "Lagos",
        venue: "Hall",
        startsAt: "2026-12-01T10:00:00Z",
      },
    });
    assert.equal(create.res.status, 403);
    assert.equal(create.json.error.code, "FORBIDDEN");

    const mine = await request(baseUrl, "GET", "/api/events/mine", { token: attendee.token });
    assert.equal(mine.res.status, 403);
    assert.equal(mine.json.error.code, "FORBIDDEN");
  });
});

test("S13: one organizer cannot edit another organizer's event", async () => {
  await withApi(async ({ baseUrl }) => {
    const owner = await signup(baseUrl, "owner@example.com", "organizer");
    const other = await signup(baseUrl, "other@example.com", "organizer");
    const { eventId } = await seedEvent(baseUrl, owner.token);

    const addTier = await request(baseUrl, "POST", `/api/events/${eventId}/tiers`, {
      token: other.token,
      body: { name: "Sneaky", priceCents: 1000, capacity: 10 },
    });
    assert.equal(addTier.res.status, 403);
    assert.equal(addTier.json.error.code, "FORBIDDEN");

    const unpublish = await request(baseUrl, "POST", `/api/events/${eventId}/unpublish`, {
      token: other.token,
    });
    assert.equal(unpublish.res.status, 403);
    assert.equal(unpublish.json.error.code, "FORBIDDEN");

    const publish = await request(baseUrl, "POST", `/api/events/${eventId}/publish`, {
      token: other.token,
    });
    assert.equal(publish.res.status, 403);
    assert.equal(publish.json.error.code, "FORBIDDEN");

    const mine = await request(baseUrl, "GET", "/api/events/mine", { token: other.token });
    assert.equal(mine.res.status, 200);
    assert.deepEqual(mine.json.events, []);
  });
});

test("S13: an attendee sees only their own bookings", async () => {
  await withApi(async ({ baseUrl }) => {
    const organizer = await signup(baseUrl, "org@example.com", "organizer");
    const ada = await signup(baseUrl, "ada@example.com", "attendee");
    const bayo = await signup(baseUrl, "bayo@example.com", "attendee");
    const { tierId } = await seedEvent(baseUrl, organizer.token);

    const adaBooking = await request(baseUrl, "POST", "/api/bookings", {
      token: ada.token,
      body: { tierId, quantity: 1 },
    });
    const bayoBooking = await request(baseUrl, "POST", "/api/bookings", {
      token: bayo.token,
      body: { tierId, quantity: 1 },
    });
    assert.equal(adaBooking.res.status, 201);
    assert.equal(bayoBooking.res.status, 201);

    const adaList = await request(baseUrl, "GET", "/api/bookings", { token: ada.token });
    assert.equal(adaList.res.status, 200);
    assert.equal(adaList.json.bookings.length, 1);
    assert.equal(adaList.json.bookings[0].reference, adaBooking.json.reference);

    const bayoReadsAda = await request(baseUrl, "GET", `/api/bookings/${adaBooking.json.reference}`, {
      token: bayo.token,
    });
    assert.equal(bayoReadsAda.res.status, 403);
    assert.equal(bayoReadsAda.json.error.code, "FORBIDDEN");

    const anonymousList = await request(baseUrl, "GET", "/api/bookings");
    assert.equal(anonymousList.res.status, 401);
    assert.equal(anonymousList.json.error.code, "UNAUTHENTICATED");
  });
});
