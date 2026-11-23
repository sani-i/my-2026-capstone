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

export function applySchema(db, schemaSql) {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schemaSql);
}

export function createDatabase(dbPath, schemaSql) {
  const db = openDatabase(dbPath);
  applySchema(db, schemaSql);
  return db;
}
