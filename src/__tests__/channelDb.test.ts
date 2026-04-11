import { describe, it, expect, beforeEach } from "bun:test";
import { makeChannelDb } from "../channelDb.js";
import { makeTestDb } from "./helpers/schema.js";
import type { Database } from "bun:sqlite";

describe("makeChannelDb", () => {
  let db: Database;
  let channelDb: ReturnType<typeof makeChannelDb>;

  beforeEach(() => {
    db = makeTestDb();
    channelDb = makeChannelDb(db);
  });

  it("getVoiceChannelId returns null before anything is set", () => {
    expect(channelDb.getVoiceChannelId()).toBeNull();
  });

  it("setVoiceChannelId then getVoiceChannelId returns the set value", () => {
    channelDb.setVoiceChannelId("123");
    expect(channelDb.getVoiceChannelId()).toBe("123");
  });

  it("setVoiceChannelId called twice — second call overwrites the first", () => {
    channelDb.setVoiceChannelId("123");
    channelDb.setVoiceChannelId("456");
    expect(channelDb.getVoiceChannelId()).toBe("456");
  });

  it("getTextChannelId returns null before anything is set", () => {
    expect(channelDb.getTextChannelId()).toBeNull();
  });

  it("voice and text channel IDs are stored independently", () => {
    channelDb.setVoiceChannelId("voice-111");
    expect(channelDb.getTextChannelId()).toBeNull();

    channelDb.setTextChannelId("text-222");
    expect(channelDb.getVoiceChannelId()).toBe("voice-111");
    expect(channelDb.getTextChannelId()).toBe("text-222");
  });
});
