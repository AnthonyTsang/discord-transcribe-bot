import type { Database } from "bun:sqlite";

/** Factory that creates word boost DB operations bound to a given database instance. */
export function makeWordBoostDb(db: Database) {
  const stmtAdd    = db.prepare(`INSERT OR IGNORE INTO word_boost (word) VALUES (?)`);
  const stmtRemove = db.prepare(`DELETE FROM word_boost WHERE word = ?`);
  const stmtList   = db.prepare<{ word: string }, []>(
    `SELECT word FROM word_boost ORDER BY word`
  );

  /** Adds a word/phrase. Returns true if it was newly inserted. */
  function addWord(word: string): boolean {
    return stmtAdd.run(word.trim()).changes > 0;
  }

  /** Removes a word/phrase. Returns true if it existed. */
  function removeWord(word: string): boolean {
    return stmtRemove.run(word.trim()).changes > 0;
  }

  /** Returns all stored words, sorted alphabetically. */
  function getWords(): string[] {
    return stmtList.all().map((r) => r.word);
  }

  return { addWord, removeWord, getWords };
}

// Compatibility shim — existing callers in index.ts are unchanged.
import db from "./db.js";
export const { addWord, removeWord, getWords } = makeWordBoostDb(db);
