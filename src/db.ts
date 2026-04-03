/**
 * Single shared SQLite database instance for the whole bot.
 * All modules import from here so we stay on one connection.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { resolve } from "path";

// Resolve from project root (one level up from src/)
const DATA_DIR = resolve(import.meta.dir, "..", "data");

try {
  mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  console.error("[db] Failed to create data directory:", DATA_DIR, err);
  process.exit(1);
}

const DB_PATH = resolve(DATA_DIR, "bot.db");
console.log("[db] Opening database at:", DB_PATH);
const db = new Database(DB_PATH, { create: true });

// WAL mode is safer under multiple concurrent reads from the same process
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS word_boost (
    word TEXT PRIMARY KEY COLLATE NOCASE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS access_control (
    type TEXT NOT NULL CHECK(type IN ('role', 'user')),
    id   TEXT NOT NULL,
    PRIMARY KEY (type, id)
  );

  CREATE TABLE IF NOT EXISTS muted_users (
    user_id TEXT PRIMARY KEY
  );
`);

export default db;
