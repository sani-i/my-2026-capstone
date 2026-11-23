import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import { createSqliteRepository } from "../src/repositories/sqlite.js";
import { createBookingService } from "../src/services/bookingService.js";
import { createMockPaymentGateway } from "../src/lib/mockPaymentGateway.js";

const schemaSql = fs.readFileSync(path.resolve("src/db/schema.sql"), "utf8");

function makeTempDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oversell-"));
  return path.join(dir, name);
}

async function setup(dbPath) {
  const db = createDatabase(dbPath, schemaSql);
  const repo = createSqliteRepository(db);
  const event = await repo.createEvent({
    organizerId: "org-1",
    title: "Last Seat Show",
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
  return { db, repo, tier, event };
}

async function beforeDemo() {
  const dbPath = makeTempDb("before.db");
  const { db, tier, event } = await setup(dbPath);

  // Simulate broken read-check-write: all 50 read stale state, then all attempt writes.
  // This makes the lost-update race visible and deterministic.
  const readers = Array.from({ length: 50 }, () => {
    return db.prepare("SELECT sold, capacity FROM ticket_tiers WHERE id = ?").get(tier.id);
  });

  const attempts = readers.map((row, i) => async () => {
    const userId = `user-${i}`;
    db.prepare("INSERT OR IGNORE INTO users (id, name, email, role) VALUES (?, '', '', '')").run(userId);
    const remaining = row.capacity - row.sold;
    if (1 > remaining) {
      return { ok: false, code: "SOLD_OUT" };
    }
    // Broken: non-atomic write based on stale read (lost update).
    // Each request computed sold = row.sold + 1 = 1 and wrote it, so CHECK passes
    // but multiple bookings are inserted for the same seat.
    const nextSold = row.sold + 1;
    db.prepare("UPDATE ticket_tiers SET sold = ? WHERE id = ?").run(nextSold, tier.id);
    db.prepare(
      `INSERT INTO bookings (id, reference, event_id, tier_id, user_id, quantity, amount_cents, status, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 1000, 'pending', ?)`,
    ).run(`b-${i}`, `REF-${i}`, event.id, tier.id, userId, new Date().toISOString());
    return { ok: true };
  });

  const results = await Promise.all(attempts.map((fn) => fn()));
  const success = results.filter((r) => r.ok).length;
  const soldOut = results.filter((r) => !r.ok).length;
  const tierRow = db.prepare("SELECT sold, capacity FROM ticket_tiers WHERE id = ?").get(tier.id);
  const bookingCount = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE tier_id = ?").get(tier.id).c;
  db.close();
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch {}
  return { success, soldOut, sold: tierRow.sold, capacity: tierRow.capacity, bookingCount };
}

async function afterDemo() {
  const dbPath = makeTempDb("after.db");
  const { db, repo, tier } = await setup(dbPath);
  const service = createBookingService(repo, createMockPaymentGateway());

  const attempts = Array.from({ length: 50 }, (_, i) =>
    service
      .bookTickets({ tierId: tier.id, quantity: 1 }, { id: `user-${i}`, role: "attendee" })
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, code: err.code })),
  );

  const results = await Promise.all(attempts);
  const success = results.filter((r) => r.ok).length;
  const soldOut = results.filter((r) => r.code === "SOLD_OUT").length;
  const tierRow = db.prepare("SELECT sold, capacity FROM ticket_tiers WHERE id = ?").get(tier.id);
  const bookingCount = db.prepare("SELECT COUNT(*) AS c FROM bookings WHERE tier_id = ?").get(tier.id).c;
  db.close();
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch {}
  return { success, soldOut, sold: tierRow.sold, capacity: tierRow.capacity, bookingCount };
}

const before = await beforeDemo();
const after = await afterDemo();

console.log("=== Build 5 oversell demo (50 concurrent bookings for 1 seat) ===\n");
console.log("BEFORE (broken read-check-write, stale reads then writes):");
console.log(`  success:   ${before.success}`);
console.log(`  SOLD_OUT:  ${before.soldOut}`);
console.log(`  sold/cap:  ${before.sold}/${before.capacity}`);
console.log(`  bookings:  ${before.bookingCount}`);

console.log("\nAFTER (atomic UPDATE ... WHERE sold + ? <= capacity):");
console.log(`  success:   ${after.success}`);
console.log(`  SOLD_OUT:  ${after.soldOut}`);
console.log(`  sold/cap:  ${after.sold}/${after.capacity}`);
console.log(`  bookings:  ${after.bookingCount}`);
