import { Database } from "bun:sqlite";

export function makeTestDb(): Database {
  const db = new Database(":memory:");

  db.run(`
    CREATE TABLE IF NOT EXISTS word_boost (
      word TEXT PRIMARY KEY COLLATE NOCASE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS access_control (
      type TEXT NOT NULL CHECK(type IN ('role','user')),
      id TEXT NOT NULL,
      PRIMARY KEY (type, id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS muted_users (
      user_id TEXT PRIMARY KEY
    )
  `);

  return db;
}
