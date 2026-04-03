import type { Database } from "bun:sqlite";

/** Factory that creates mute DB operations bound to a given database instance. */
export function makeMuteDb(db: Database) {
  const stmtMute   = db.prepare(`INSERT OR IGNORE INTO muted_users (user_id) VALUES (?)`);
  const stmtUnmute = db.prepare(`DELETE FROM muted_users WHERE user_id = ?`);
  const stmtList   = db.prepare<{ user_id: string }, []>(
    `SELECT user_id FROM muted_users ORDER BY user_id`
  );
  const stmtCheck  = db.prepare<{ user_id: string }, [string]>(
    `SELECT user_id FROM muted_users WHERE user_id = ?`
  );

  /** Mutes a user. Returns true if they were newly added. */
  function muteUser(userId: string): boolean {
    return stmtMute.run(userId).changes > 0;
  }

  /** Unmutes a user. Returns true if they were in the list. */
  function unmuteUser(userId: string): boolean {
    return stmtUnmute.run(userId).changes > 0;
  }

  /** Returns all muted user IDs. */
  function getMutedUsers(): string[] {
    return stmtList.all().map((r) => r.user_id);
  }

  /** Returns true if the user is currently muted. */
  function isUserMuted(userId: string): boolean {
    return stmtCheck.get(userId) !== null;
  }

  return { muteUser, unmuteUser, getMutedUsers, isUserMuted };
}

// Compatibility shim — existing callers in index.ts are unchanged.
import db from "./db.js";
export const { muteUser, unmuteUser, getMutedUsers, isUserMuted } = makeMuteDb(db);
