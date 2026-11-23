import test from "node:test";
import assert from "node:assert/strict";
import { withApi, request, signup, seedEvent } from "./helpers.js";
import { createRateLimiter } from "../src/lib/rateLimit.js";

async function makePaidBooking(baseUrl, organizerToken, attendeeToken) {
  const { eventId, tierId } = await seedEvent(baseUrl, organizerToken);
  const created = await request(baseUrl, "POST", "/api/bookings", {
    token: attendeeToken,
    body: { tierId, quantity: 1 },
  });
  assert.equal(created.res.status, 201);
  const reference = created.json.reference;

  const paid = await request(baseUrl, "POST", `/api/bookings/${reference}/pay`, {
    token: attendeeToken,
    body: { paymentToken: "tok_success" },
  });
  assert.equal(paid.res.status, 200);

  const ticket = await request(baseUrl, "GET", `/api/bookings/${reference}/ticket`, {
    token: attendeeToken,
  });
  assert.equal(ticket.res.status, 200);
  return { eventId, tierId, reference, code: ticket.json.code };
}

async function staffAndAttendee(baseUrl) {
  const organizer = await signup(baseUrl, "organizer@example.com", "organizer");
  const attendee = await signup(baseUrl, "attendee@example.com", "attendee");
  const staff = await signup(baseUrl, "staff@example.com", "staff");
  return { organizerToken: organizer.token, attendeeToken: attendee.token, staffToken: staff.token };
}

function scan(baseUrl, staffToken, code, eventId) {
  return request(baseUrl, "POST", "/api/checkin", {
    token: staffToken,
    body: { code, eventId },
  });
}

test("paid booking gets a ticket code; pending or someone else's booking does not", async () => {
  await withApi(async ({ baseUrl }) => {
    const { organizerToken, attendeeToken } = await staffAndAttendee(baseUrl);
    const other = await signup(baseUrl, "other@example.com", "attendee");
    const booking = await makePaidBooking(baseUrl, organizerToken, attendeeToken);

    const denied = await request(baseUrl, "GET", `/api/bookings/${booking.reference}/ticket`, {
      token: other.token,
    });
    assert.equal(denied.res.status, 403);
    assert.equal(denied.json.error.code, "FORBIDDEN");

    const { tierId } = await seedEvent(baseUrl, organizerToken);
    const pending = await request(baseUrl, "POST", "/api/bookings", {
      token: attendeeToken,
      body: { tierId, quantity: 1 },
    });
    const pendingTicket = await request(
      baseUrl,
      "GET",
      `/api/bookings/${pending.json.reference}/ticket`,
      { token: attendeeToken },
    );
    assert.equal(pendingTicket.res.status, 409);
    assert.equal(pendingTicket.json.error.code, "INVALID_STATE");
  });
});

test("forged or made-up codes are INVALID_TICKET", async () => {
  await withApi(async ({ baseUrl }) => {
    const { organizerToken, attendeeToken, staffToken } = await staffAndAttendee(baseUrl);
    const booking = await makePaidBooking(baseUrl, organizerToken, attendeeToken);
    const [payload, signature] = booking.code.split(".");
    const forgedSignature = `${signature.slice(0, -1)}${signature.at(-1) === "A" ? "B" : "A"}`;

    for (const code of [`${payload}.${forgedSignature}`, "made.up.code", "not-a-ticket"]) {
      const result = await scan(baseUrl, staffToken, code, booking.eventId);
      assert.equal(result.res.status, 400);
      assert.equal(result.json.error.code, "INVALID_TICKET");
    }
  });
});

test("a second scan is rejected as DUPLICATE_CHECKIN with the first scan time", async () => {
  await withApi(async ({ baseUrl }) => {
    const { organizerToken, attendeeToken, staffToken } = await staffAndAttendee(baseUrl);
    const booking = await makePaidBooking(baseUrl, organizerToken, attendeeToken);

    const first = await scan(baseUrl, staffToken, booking.code, booking.eventId);
    assert.equal(first.res.status, 200);
    assert.equal(first.json.status, "checked_in");
    assert.ok(first.json.checkedInAt);

    const second = await scan(baseUrl, staffToken, booking.code, booking.eventId);
    assert.equal(second.res.status, 409);
    assert.equal(second.json.error.code, "DUPLICATE_CHECKIN");
    assert.equal(second.json.error.checkedInAt, first.json.checkedInAt);
    assert.match(second.json.error.message, /already checked in/i);
  });
});

test("cancelled bookings and tickets for another event are rejected", async () => {
  await withApi(async ({ baseUrl }) => {
    const { organizerToken, attendeeToken, staffToken } = await staffAndAttendee(baseUrl);
    const booking = await makePaidBooking(baseUrl, organizerToken, attendeeToken);
    const otherEvent = await seedEvent(baseUrl, organizerToken, { title: "Other show" });

    const wrongEvent = await scan(baseUrl, staffToken, booking.code, otherEvent.eventId);
    assert.equal(wrongEvent.res.status, 409);
    assert.equal(wrongEvent.json.error.code, "WRONG_EVENT");

    const cancelled = await request(baseUrl, "POST", `/api/bookings/${booking.reference}/cancel`, {
      token: attendeeToken,
      body: {},
    });
    assert.equal(cancelled.res.status, 200);

    const rejected = await scan(baseUrl, staffToken, booking.code, booking.eventId);
    assert.equal(rejected.res.status, 400);
    assert.equal(rejected.json.error.code, "INVALID_TICKET");
  });
});

test("attendees and anonymous callers cannot check in", async () => {
  await withApi(async ({ baseUrl }) => {
    const { organizerToken, attendeeToken, staffToken } = await staffAndAttendee(baseUrl);
    const booking = await makePaidBooking(baseUrl, organizerToken, attendeeToken);

    const attendee = await request(baseUrl, "POST", "/api/checkin", {
      token: attendeeToken,
      body: { code: booking.code },
    });
    assert.equal(attendee.res.status, 403);
    assert.equal(attendee.json.error.code, "FORBIDDEN");

    const anonymous = await request(baseUrl, "POST", "/api/checkin", {
      body: { code: booking.code },
    });
    assert.equal(anonymous.res.status, 401);
    assert.equal(anonymous.json.error.code, "UNAUTHENTICATED");

    // The rejected attempts did not consume the ticket.
    const staff = await scan(baseUrl, staffToken, booking.code, booking.eventId);
    assert.equal(staff.res.status, 200);
  });
});

test("two simultaneous scans admit exactly one booking", async () => {
  await withApi(async ({ baseUrl }) => {
    const { organizerToken, attendeeToken, staffToken } = await staffAndAttendee(baseUrl);
    const booking = await makePaidBooking(baseUrl, organizerToken, attendeeToken);

    const [first, second] = await Promise.all([
      scan(baseUrl, staffToken, booking.code, booking.eventId),
      scan(baseUrl, staffToken, booking.code, booking.eventId),
    ]);

    const statuses = [first.res.status, second.res.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const winner = first.res.status === 200 ? first : second;
    const loser = first.res.status === 200 ? second : first;
    assert.equal(loser.json.error.code, "DUPLICATE_CHECKIN");
    assert.equal(loser.json.error.checkedInAt, winner.json.checkedInAt);
  });
});

test("login and check-in attempts are rate limited per IP", async () => {
  const loginLimiter = createRateLimiter({ max: 1, windowMs: 60_000 });
  const checkinLimiter = createRateLimiter({ max: 1, windowMs: 60_000 });
  await withApi(
    async ({ baseUrl }) => {
      await signup(baseUrl, "attendee@example.com", "attendee");
      const firstLogin = await request(baseUrl, "POST", "/api/auth/login", {
        body: { email: "attendee@example.com", password: "password123" },
      });
      const secondLogin = await request(baseUrl, "POST", "/api/auth/login", {
        body: { email: "attendee@example.com", password: "password123" },
      });
      assert.equal(firstLogin.res.status, 200);
      assert.equal(secondLogin.res.status, 429);
      assert.equal(secondLogin.json.error.code, "RATE_LIMITED");
      assert.ok(secondLogin.res.headers.get("retry-after"));

      const loginAs = async (email, role) => {
        const result = await signup(baseUrl, email, role);
        return result.token;
      };
      const organizerToken = await loginAs("organizer@example.com", "organizer");
      const attendeeToken = await loginAs("attendee2@example.com", "attendee");
      const staffToken = await loginAs("staff@example.com", "staff");
      const booking = await makePaidBooking(baseUrl, organizerToken, attendeeToken);

      const firstScan = await scan(baseUrl, staffToken, booking.code, booking.eventId);
      const secondScan = await scan(baseUrl, staffToken, booking.code, booking.eventId);
      assert.equal(firstScan.res.status, 200);
      assert.equal(secondScan.res.status, 429);
      assert.equal(secondScan.json.error.code, "RATE_LIMITED");
      assert.ok(secondScan.res.headers.get("retry-after"));
    },
    {
      rateLimiters: {
        "POST /api/auth/login": loginLimiter,
        "POST /api/checkin": checkinLimiter,
      },
    },
  );
});

test("security headers are applied to API and static responses", async () => {
  await withApi(async ({ baseUrl }) => {
    for (const pathname of ["/health", "/checkin.html"]) {
      const res = await fetch(`${baseUrl}${pathname}`);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.equal(res.headers.get("x-frame-options"), "DENY");
      const csp = res.headers.get("content-security-policy");
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-inline/);
    }
  });
});
