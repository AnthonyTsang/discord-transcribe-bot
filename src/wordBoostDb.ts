import db from "./db.js";

const stmtAdd    = db.prepare(`INSERT OR IGNORE INTO word_boost (word) VALUES (?)`);
const stmtRemove = db.prepare(`DELETE FROM word_boost WHERE word = ?`);
const stmtList   = db.prepare<{ word: string }, []>(
  `SELECT word FROM word_boost ORDER BY word`
);

/** Adds a word/phrase. Returns true if it was newly inserted. */
export function addWord(word: string): boolean {
  return stmtAdd.run(word.trim()).changes > 0;
}

/** Removes a word/phrase. Returns true if it existed. */
export function removeWord(word: string): boolean {
  return stmtRemove.run(word.trim()).changes > 0;
}

/** Returns all stored words, sorted alphabetically. */
export function getWords(): string[] {
  return stmtList.all().map((r) => r.word);
}
