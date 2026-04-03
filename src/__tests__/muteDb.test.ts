import { describe, it, expect, beforeEach } from "bun:test";
import { makeMuteDb } from "../muteDb.js";
import { makeTestDb } from "./helpers/schema.js";
import type { Database } from "bun:sqlite";

describe("makeMuteDb", () => {
  let db: Database;
  let muteDb: ReturnType<typeof makeMuteDb>;

  beforeEach(() => {
    db = makeTestDb();
    muteDb = makeMuteDb(db);
  });

  it("isUserMuted returns false before any muting", () => {
    expect(muteDb.isUserMuted("u1")).toBe(false);
  });

  it("muteUser returns true on first call and false on duplicate", () => {
    expect(muteDb.muteUser("u1")).toBe(true);
    expect(muteDb.muteUser("u1")).toBe(false);
  });

  it("isUserMuted returns true after muting", () => {
    muteDb.muteUser("u1");
    expect(muteDb.isUserMuted("u1")).toBe(true);
  });

  it("unmuteUser returns true and isUserMuted returns false after unmuting", () => {
    muteDb.muteUser("u1");
    expect(muteDb.unmuteUser("u1")).toBe(true);
    expect(muteDb.isUserMuted("u1")).toBe(false);
  });

  it("unmuteUser on non-muted user returns false", () => {
    expect(muteDb.unmuteUser("u1")).toBe(false);
  });

  it("getMutedUsers returns sorted list of muted users", () => {
    muteDb.muteUser("charlie");
    muteDb.muteUser("alice");
    muteDb.muteUser("bob");
    expect(muteDb.getMutedUsers()).toEqual(["alice", "bob", "charlie"]);
  });

  it("getMutedUsers returns empty array when nobody is muted", () => {
    expect(muteDb.getMutedUsers()).toEqual([]);
  });

  it("muting user A does not affect user B's muted status", () => {
    muteDb.muteUser("userA");
    expect(muteDb.isUserMuted("userB")).toBe(false);
  });
});
