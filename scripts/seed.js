import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../src/db/connection.js";
import { createSqliteRepository } from "../src/repositories/sqlite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, "..", process.env.DATABASE_PATH || "data/ticketing.db");
const schemaSql = fs.readFileSync(path.resolve(__dirname, "../src/db/schema.sql"), "utf8");

const db = createDatabase(dbPath, schemaSql);
const repo = createSqliteRepository(db);

const existing = await repo.listEvents();
if (existing.length > 0) {
  console.log(`Database already has ${existing.length} event(s). Skipping seed.`);
  console.log(`Database: ${dbPath}`);
  process.exit(0);
}

const organizerId = "org-seed";
const event = await repo.createEvent({
  organizerId,
  title: "Lagos Tech Meetup",
  city: "Lagos",
  venue: "Landmark Centre",
  startsAt: "2026-12-05T17:00:00Z",
});

await repo.createTier({
  eventId: event.id,
  name: "General",
  priceCents: 500000,
  capacity: 100,
});
await repo.createTier({
  eventId: event.id,
  name: "VIP",
  priceCents: 1500000,
  capacity: 20,
});

event.status = "published";
await repo.saveEvent(event);

const event2 = await repo.createEvent({
  organizerId,
  title: "Abuja Jazz Night",
  city: "Abuja",
  venue: "Musa Yar'Adua Centre",
  startsAt: "2026-12-20T19:00:00Z",
});
await repo.createTier({
  eventId: event2.id,
  name: "Regular",
  priceCents: 250000,
  capacity: 50,
});
event2.status = "published";
await repo.saveEvent(event2);

console.log("Seeded database with sample events.");
console.log(`Database: ${dbPath}`);
