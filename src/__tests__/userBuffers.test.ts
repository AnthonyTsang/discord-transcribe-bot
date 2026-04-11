import { describe, it, expect, beforeEach } from "bun:test";
import {
  writePcm,
  getUserBufferedMs,
  getUserRms,
  flushUserWav,
  resetUser,
  resetAll,
} from "../userBuffers.js";
import { makePcmBuffer } from "./helpers/pcm.js";

beforeEach(() => {
  resetAll();
});

// ── writePcm / getUserBufferedMs ──────────────────────────────────────────────

describe("writePcm / getUserBufferedMs", () => {
  it("writing a PCM buffer records a non-zero buffered duration", () => {
    const pcm = makePcmBuffer(20, 1000);
    writePcm("u1", pcm, Date.now());
    expect(getUserBufferedMs("u1")).toBeGreaterThan(0);
  });

  it("two users maintain independent buffers", () => {
    const pcmA = makePcmBuffer(20, 1000);
    writePcm("u1", pcmA, Date.now());
    // u2 has never written — should still be 0
    expect(getUserBufferedMs("u2")).toBe(0);
    // writing for u2 should not affect u1
    const pcmB = makePcmBuffer(10, 500);
    writePcm("u2", pcmB, Date.now());
    const msA = getUserBufferedMs("u1");
    const msB = getUserBufferedMs("u2");
    expect(msA).toBeGreaterThan(0);
    expect(msB).toBeGreaterThan(0);
    // u1 had 20 ms worth; u2 had 10 ms worth — they should differ
    expect(msA).not.toBe(msB);
  });

  it("getUserBufferedMs returns 0 for a user who has never written", () => {
    expect(getUserBufferedMs("nobody")).toBe(0);
  });
});

// ── Volume normalization ──────────────────────────────────────────────────────

describe("volume normalization", () => {
  it("a zero-amplitude buffer is stored as-is and getUserRms returns 0", () => {
    // All bytes are zero → RMS = 0, which is < MIN_RMS (100), so no gain applied
    const pcm = makePcmBuffer(20, 0);
    writePcm("u1", pcm, Date.now());
    expect(getUserRms("u1")).toBe(0);
  });

  it("a loud buffer at amplitude 32000 has RMS > 0 and <= 32767", () => {
    const pcm = makePcmBuffer(20, 32000);
    writePcm("u1", pcm, Date.now());
    const rms = getUserRms("u1");
    expect(rms).toBeGreaterThan(0);
    expect(rms).toBeLessThanOrEqual(32767);
  });
});

// ── getUserRms ────────────────────────────────────────────────────────────────

describe("getUserRms", () => {
  it("returns 0 for a user with no buffer", () => {
    expect(getUserRms("no-such-user")).toBe(0);
  });
});

// ── flushUserWav ─────────────────────────────────────────────────────────────

describe("flushUserWav", () => {
  it("returns null for a user with no data", () => {
    expect(flushUserWav("nobody")).toBeNull();
  });

  it("returns a Buffer with RIFF and WAVE markers for a user with data", () => {
    const pcm = makePcmBuffer(20, 1000);
    writePcm("u1", pcm, Date.now());
    const result = flushUserWav("u1");
    expect(result).not.toBeNull();
    const wav = result!.wav;
    // bytes 0-3: "RIFF"
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    // bytes 8-11: "WAVE"
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("clears the buffer after flush — getUserBufferedMs returns 0", () => {
    const pcm = makePcmBuffer(20, 1000);
    writePcm("u1", pcm, Date.now());
    expect(getUserBufferedMs("u1")).toBeGreaterThan(0);
    flushUserWav("u1");
    expect(getUserBufferedMs("u1")).toBe(0);
  });

  it("WAV dataBytes field at offset 40 equals the PCM buffer length written", () => {
    const pcm = makePcmBuffer(20, 1000);
    writePcm("u1", pcm, Date.now());
    const result = flushUserWav("u1");
    expect(result).not.toBeNull();
    const wav = result!.wav;
    // The WAV header is 44 bytes; PCM data follows
    const pcmLength = wav.length - 44;
    // bytes 40-43: little-endian uint32 data chunk size
    const dataBytes = wav.readUInt32LE(40);
    expect(dataBytes).toBe(pcmLength);
  });
});

// ── resetUser / resetAll ──────────────────────────────────────────────────────

describe("resetUser / resetAll", () => {
  it("resetUser removes one user but leaves other users intact", () => {
    writePcm("u1", makePcmBuffer(20, 1000), Date.now());
    writePcm("u2", makePcmBuffer(20, 1000), Date.now());
    resetUser("u1");
    expect(getUserBufferedMs("u1")).toBe(0);
    expect(getUserBufferedMs("u2")).toBeGreaterThan(0);
  });

  it("resetAll clears buffers for all users", () => {
    writePcm("u1", makePcmBuffer(20, 1000), Date.now());
    writePcm("u2", makePcmBuffer(20, 1000), Date.now());
    resetAll();
    expect(getUserBufferedMs("u1")).toBe(0);
    expect(getUserBufferedMs("u2")).toBe(0);
  });
});
