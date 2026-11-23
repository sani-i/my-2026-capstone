import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(dbPath) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

// Databases created in Build 7 do not have the Build 8 booking columns.
const COLUMN_MIGRATIONS = [
  ["bookings", "hold_expires_at", "ALTER TABLE bookings ADD COLUMN hold_expires_at TEXT"],
  ["bookings", "refund_cents", "ALTER TABLE bookings ADD COLUMN refund_cents INTEGER"],
  ["bookings", "refunded_at", "ALTER TABLE bookings ADD COLUMN refunded_at TEXT"],
  ["bookings", "refund_id", "ALTER TABLE bookings ADD COLUMN refund_id TEXT"],
];

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

export function applySchema(db, schemaSql) {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schemaSql);
  for (const [table, column, sql] of COLUMN_MIGRATIONS) {
    if (!hasColumn(db, table, column)) db.exec(sql);
  }
}

export function createDatabase(dbPath, schemaSql) {
  const db = openDatabase(dbPath);
  applySchema(db, schemaSql);
  return db;
}
