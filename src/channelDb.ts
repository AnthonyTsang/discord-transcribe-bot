import db from "./db.js";

const stmtGet = db.prepare<{ value: string }, [string]>(
  `SELECT value FROM settings WHERE key = ?`
);
const stmtSet = db.prepare(
  `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`
);

const KEY_VOICE = "voice_channel_id";
const KEY_TEXT  = "text_channel_id";

export function getVoiceChannelId(): string | null {
  return stmtGet.get(KEY_VOICE)?.value ?? null;
}

export function getTextChannelId(): string | null {
  return stmtGet.get(KEY_TEXT)?.value ?? null;
}

export function setVoiceChannelId(id: string): void {
  stmtSet.run(KEY_VOICE, id);
}

export function setTextChannelId(id: string): void {
  stmtSet.run(KEY_TEXT, id);
}
