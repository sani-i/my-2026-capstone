import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import { createSqliteRepository } from "../src/repositories/sqlite.js";
import { createBookingService } from "../src/services/bookingService.js";
import { createMockPaymentGateway } from "../src/lib/mockPaymentGateway.js";

const schemaSql = fs.readFileSync(path.resolve("src/db/schema.sql"), "utf8");

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oversell-test-"));
  return { dir, dbPath: path.join(dir, "test.db") };
}

async function setup() {
  const { dir, dbPath } = makeTempDb();
  const db = createDatabase(dbPath, schemaSql);
  const repo = createSqliteRepository(db);
  const service = createBookingService(repo, createMockPaymentGateway());
  const event = await repo.createEvent({
    organizerId: "org-1",
    title: "Last Seat",
    city: "Lagos",
    venue: "Hall",
    startsAt: "2026-12-01T18:00:00Z",
  });
  const tier = await repo.createTier({
    eventId: event.id,
    name: "General",
    priceCents: 1000,
    capacity: 1,
  });
  event.status = "published";
  await repo.saveEvent(event);
  return { dir, db, repo, service, tier, event };
}

test("50 simultaneous bookings for 1 seat give exactly 1 success and 49 SOLD_OUT", async () => {
  const { dir, db, tier } = await setup();
  try {
    const repo = createSqliteRepository(db);
    const service = createBookingService(repo, createMockPaymentGateway());

    const attempts = Array.from({ length: 50 }, (_, i) =>
      service
        .bookTickets({ tierId: tier.id, quantity: 1 }, `user-${i}`)
        .then((booking) => ({ ok: true, booking }))
        .catch((err) => ({ ok: false, code: err.code })),
    );

    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.ok);
    const soldOuts = results.filter((r) => !r.ok && r.code === "SOLD_OUT");

    assert.equal(successes.length, 1);
    assert.equal(soldOuts.length, 49);

    const row = db.prepare("SELECT sold, capacity FROM ticket_tiers WHERE id = ?").get(tier.id);
    assert.equal(row.sold, 1);
    assert.ok(row.sold <= row.capacity);

    const bookingCount = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE tier_id = ?").get(tier.id).c;
    assert.equal(bookingCount, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("atomic reserveSeats rejects when no seats remain (fix guard)", async () => {
  const { dir, db, repo, tier } = await setup();
  try {
    await repo.reserveSeats(tier.id, 1);
    await assert.rejects(
      () => repo.reserveSeats(tier.id, 1),
      (err) => err?.code === "SOLD_OUT",
    );
    const row = db.prepare("SELECT sold, capacity FROM ticket_tiers WHERE id = ?").get(tier.id);
    assert.equal(row.sold, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
