import type { Database } from "bun:sqlite";

/** Factory that creates channel DB operations bound to a given database instance. */
export function makeChannelDb(db: Database) {
  const stmtGet = db.prepare<{ value: string }, [string]>(
    `SELECT value FROM settings WHERE key = ?`
  );
  const stmtSet = db.prepare(
    `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`
  );

  const KEY_VOICE = "voice_channel_id";
  const KEY_TEXT  = "text_channel_id";

  function getVoiceChannelId(): string | null {
    return stmtGet.get(KEY_VOICE)?.value ?? null;
  }

  function getTextChannelId(): string | null {
    return stmtGet.get(KEY_TEXT)?.value ?? null;
  }

  function setVoiceChannelId(id: string): void {
    stmtSet.run(KEY_VOICE, id);
  }

  function setTextChannelId(id: string): void {
    stmtSet.run(KEY_TEXT, id);
  }

  return { getVoiceChannelId, getTextChannelId, setVoiceChannelId, setTextChannelId };
}

// Compatibility shim — existing callers in index.ts are unchanged.
import db from "./db.js";
export const { getVoiceChannelId, getTextChannelId, setVoiceChannelId, setTextChannelId } = makeChannelDb(db);
