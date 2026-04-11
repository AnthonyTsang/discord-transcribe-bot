import { describe, it, expect, beforeEach, mock } from "bun:test";
import { makePcmBuffer } from "./helpers/pcm.js";

// Mock config before importing chunkManager (poster.js imports config at module level).
mock.module("../../src/config.js", () => ({
  config: { minConfidence: 0.4 },
}));

// Dynamic imports so mocks are in place before modules execute.
const chunkManager = await import("../chunkManager.js");
const userBuffers = await import("../userBuffers.js");

import type { ChunkManagerDeps } from "../chunkManager.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fakeDeps: ChunkManagerDeps;

beforeEach(() => {
  userBuffers.resetAll();
  chunkManager.resetForNewSession();
  fakeDeps = {
    config: { minChunkMs: 500, maxChunkMs: 60000, silenceRmsThreshold: 500 },
    transcribe: mock(() => Promise.resolve({ words: [] })),
    sessionManager: {
      getSession: mock(() =>
        ({
          logFilePath: "/tmp/test.log",
          transcriptIds: [],
          accumulatedLines: [],
          thread: null as unknown,
          startTime: 0,
          paused: false,
        }) as ReturnType<ChunkManagerDeps["sessionManager"]["getSession"]>
      ),
      isPaused: mock(() => false),
      addTranscriptId: mock(() => {}),
      accumulateLines: mock(() => {}),
    },
    transcriptLogger: {
      appendLines: mock(() => Promise.resolve()),
    },
  };
  chunkManager.init(fakeDeps);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getActiveSpeakers", () => {
  it("returns a set containing the user after onUserStartedSpeaking", () => {
    chunkManager.onUserStartedSpeaking("u1", "Alice");
    const speakers = chunkManager.getActiveSpeakers();
    expect(speakers.has("u1")).toBe(true);
    expect(speakers.size).toBe(1);
  });

  it("returns empty set when no users are speaking", () => {
    expect(chunkManager.getActiveSpeakers().size).toBe(0);
  });
});

describe("silence detection", () => {
  it("does NOT call transcribe for a silent (all-zero) buffer", async () => {
    // Write silent audio (all zeros) — 200ms is enough to exceed the 100ms minimum
    const silent = Buffer.alloc(48000 * 2 * 2 * 0.2); // 200ms of silence
    chunkManager.onUserStartedSpeaking("u1", "Alice");
    userBuffers.writePcm("u1", silent, Date.now());

    await chunkManager.forceFlushAll();

    expect(fakeDeps.transcribe).not.toHaveBeenCalled();
  });
});

describe("audible buffer transcribed", () => {
  it("calls transcribe for an audible buffer", async () => {
    // Write loud PCM — amplitude 10000 will be well above silence threshold
    const loud = makePcmBuffer(200, 10000);
    chunkManager.onUserStartedSpeaking("u1", "Alice");
    userBuffers.writePcm("u1", loud, Date.now());

    await chunkManager.forceFlushAll();

    expect(fakeDeps.transcribe).toHaveBeenCalled();
  });
});

describe("forceFlushAll clears buffers", () => {
  it("clears buffers for all users after flushing", async () => {
    const loud = makePcmBuffer(200, 10000);

    chunkManager.onUserStartedSpeaking("u1", "Alice");
    userBuffers.writePcm("u1", loud, Date.now());

    chunkManager.onUserStartedSpeaking("u2", "Bob");
    userBuffers.writePcm("u2", loud, Date.now());

    await chunkManager.forceFlushAll();

    expect(userBuffers.getUserBufferedMs("u1")).toBe(0);
    expect(userBuffers.getUserBufferedMs("u2")).toBe(0);
  });
});

describe("resetForNewSession", () => {
  it("clears active speakers", () => {
    chunkManager.onUserStartedSpeaking("u1", "Alice");
    expect(chunkManager.getActiveSpeakers().size).toBe(1);

    chunkManager.resetForNewSession();
    expect(chunkManager.getActiveSpeakers().size).toBe(0);
  });
});
