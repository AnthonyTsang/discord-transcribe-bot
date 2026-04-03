import * as userBuffers from "./userBuffers.js";
import type { TranscriptWord } from "./transcriber.js";
import type { TranscribeResult } from "./transcriber.js";
import { buildTranscriptLines } from "./poster.js";
import type { Session } from "./sessionManager.js";

export interface ChunkManagerDeps {
  config: {
    minChunkMs: number;
    maxChunkMs: number;
    silenceRmsThreshold: number;
  };
  transcribe: (wav: Buffer, speaker?: string) => Promise<TranscribeResult>;
  sessionManager: {
    getSession(): Session | null;
    isPaused(): boolean;
    addTranscriptId(id: string): void;
    accumulateLines(sortKey: number, speaker: string, lines: string[]): void;
  };
  transcriptLogger: {
    appendLines(lines: string[], filePath: string): Promise<void>;
  };
}

let deps: ChunkManagerDeps;

export function init(d: ChunkManagerDeps): void {
  deps = d;
}

/** How long (ms) to wait after a user stops speaking before flushing their buffer. */
const SPEAKER_SWITCH_DEBOUNCE_MS = 200;

type UserState = "idle" | "buffering" | "flushing";

interface PendingResult {
  seq: number;
  words: TranscriptWord[];
  chunkStartMs: number;
  speaker: string;
}

interface UserChunkState {
  displayName: string;
  state: UserState;
  maxTimer: ReturnType<typeof setTimeout> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  /** Monotonically increasing per-user sequence number assigned at flush time. */
  flushSeq: number;
  /** Next sequence number that should be posted (in-order guarantee per user). */
  nextPostSeq: number;
  pendingResults: Map<number, PendingResult>;
}

const userStates = new Map<string, UserChunkState>();

/** Tracks all in-flight transcription API calls so forceFlushAll can await them. */
const inFlightTranscriptions = new Set<Promise<void>>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOrCreate(userId: string, displayName: string): UserChunkState {
  let s = userStates.get(userId);
  if (!s) {
    s = {
      displayName,
      state: "idle",
      maxTimer: null,
      debounceTimer: null,
      flushSeq: 0,
      nextPostSeq: 0,
      pendingResults: new Map(),
    };
    userStates.set(userId, s);
  }
  return s;
}

function clearTimers(s: UserChunkState): void {
  if (s.maxTimer)    { clearTimeout(s.maxTimer);    s.maxTimer    = null; }
  if (s.debounceTimer) { clearTimeout(s.debounceTimer); s.debounceTimer = null; }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called by voiceHandler when a user starts speaking.
 * Creates their state machine if needed and starts their max-duration timer.
 */
export function onUserStartedSpeaking(userId: string, displayName: string): void {
  if (deps.sessionManager.isPaused()) return;
  const s = getOrCreate(userId, displayName);
  if (s.state !== "idle") return; // already buffering or mid-flush

  s.state = "buffering";
  console.log(`[chunkManager] ${s.displayName} started speaking.`);

  if (s.maxTimer === null) {
    s.maxTimer = setTimeout(() => {
      s.maxTimer = null;
      console.log(`[chunkManager] Max duration reached for ${s.displayName}, flushing.`);
      doFlush(userId).catch(console.error);
    }, deps.config.maxChunkMs);
  }
}

/**
 * Called by voiceHandler when a user stops speaking.
 * Starts a short debounce before flushing in case they start again immediately.
 */
export function onUserStoppedSpeaking(userId: string): void {
  const s = userStates.get(userId);
  if (!s || s.state !== "buffering") return;
  console.log(`[chunkManager] ${s.displayName} stopped speaking.`);

  if (s.debounceTimer) clearTimeout(s.debounceTimer);
  s.debounceTimer = setTimeout(() => {
    s.debounceTimer = null;
    evaluateFlush(userId);
  }, SPEAKER_SWITCH_DEBOUNCE_MS);
}

/**
 * Updates the display name for an active user (called after async member fetch resolves).
 */
export function updateUserDisplayName(userId: string, displayName: string): void {
  const s = userStates.get(userId);
  if (s) s.displayName = displayName;
}

/** Returns user IDs that are currently in the buffering state (actively speaking). */
export function getActiveSpeakers(): Set<string> {
  const active = new Set<string>();
  for (const [userId, s] of userStates) {
    if (s.state === "buffering") active.add(userId);
  }
  return active;
}

/** Flushes all users' buffers immediately and waits for all in-flight transcriptions to complete. */
export async function forceFlushAll(): Promise<void> {
  const flushPromises: Promise<void>[] = [];
  for (const [userId, s] of userStates) {
    clearTimers(s);
    if (userBuffers.getUserBufferedMs(userId) >= 100) {
      flushPromises.push(doFlush(userId));
    }
  }
  await Promise.all(flushPromises);
  // Wait for any transcription API calls already in flight (started before forceFlushAll)
  await Promise.all([...inFlightTranscriptions]);
}

/** Resets all per-user state. Called at the start of each new session. */
export function resetForNewSession(): void {
  for (const [, s] of userStates) clearTimers(s);
  userStates.clear();
  userBuffers.resetAll();
}

// ── Internal ──────────────────────────────────────────────────────────────────

function evaluateFlush(userId: string): void {
  const s = userStates.get(userId);
  if (!s || s.state !== "buffering") return;

  const bufferedMs = userBuffers.getUserBufferedMs(userId);
  if (bufferedMs < deps.config.minChunkMs) {
    console.log(
      `[chunkManager] ${s.displayName}: ${bufferedMs.toFixed(0)}ms buffered (min ${deps.config.minChunkMs}ms), waiting.`
    );
    return;
  }

  doFlush(userId).catch(console.error);
}

async function doFlush(userId: string): Promise<void> {
  const s = userStates.get(userId);
  if (!s || s.state === "flushing") return;
  if (userBuffers.getUserBufferedMs(userId) < 100) return;

  clearTimers(s);
  s.state = "flushing";

  // Silence detection — discard before assigning a sequence number so no gaps form
  if (deps.config.silenceRmsThreshold > 0) {
    const rms = userBuffers.getUserRms(userId);
    if (rms < deps.config.silenceRmsThreshold) {
      console.log(
        `[chunkManager] ${s.displayName}: silent chunk (RMS ${rms.toFixed(0)}), discarding.`
      );
      userBuffers.resetUser(userId);
      s.state = "idle";
      return;
    }
  }

  const flushed = userBuffers.flushUserWav(userId);
  if (!flushed) { s.state = "idle"; return; }

  const { wav, startMs: chunkStartMs } = flushed;
  const seq = s.flushSeq++;
  const speaker = s.displayName; // capture at flush time — name is final by now
  s.state = "idle";

  console.log(
    `[chunkManager] ${speaker}: flushing seq=${seq}, ${(wav.length / 1024).toFixed(1)} KB.`
  );

  // Transcribe asynchronously; per-user ordering queue ensures their own chunks
  // are posted in recording order even if transcriptions finish out of sequence.
  const p: Promise<void> = deps.transcribe(wav, speaker)
    .then(({ words, transcriptId }) => {
      if (transcriptId) deps.sessionManager.addTranscriptId(transcriptId);
      s.pendingResults.set(seq, { seq, words, chunkStartMs, speaker });
      processQueue(userId);
    })
    .catch((err) => {
      console.error(`[chunkManager] ${speaker} seq=${seq} transcription error:`, err);
      // Insert empty result so the queue is never blocked permanently
      s.pendingResults.set(seq, { seq, words: [], chunkStartMs, speaker });
      processQueue(userId);
    })
    .finally(() => inFlightTranscriptions.delete(p));
  inFlightTranscriptions.add(p);
}

function processQueue(userId: string): void {
  const s = userStates.get(userId);
  if (!s) return;
  while (s.pendingResults.has(s.nextPostSeq)) {
    const result = s.pendingResults.get(s.nextPostSeq)!;
    s.pendingResults.delete(s.nextPostSeq);
    s.nextPostSeq++;
    postResult(result).catch((err) =>
      console.error("[chunkManager] Post error:", err)
    );
  }
}

async function postResult(result: PendingResult): Promise<void> {
  const session = deps.sessionManager.getSession();
  if (!session) return;

  const lines = buildTranscriptLines(result.words, result.speaker, result.chunkStartMs);
  if (lines.length === 0) return;

  const sortKey = result.chunkStartMs + (result.words[0]?.start ?? 0);
  deps.sessionManager.accumulateLines(sortKey, result.speaker, lines);

  await deps.transcriptLogger
    .appendLines(lines, session.logFilePath)
    .catch((err) => console.warn("[chunkManager] Log write failed:", err));
}
