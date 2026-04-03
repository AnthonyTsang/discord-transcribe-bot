import {
  ThreadAutoArchiveDuration,
  type TextChannel,
  type AnyThreadChannel,
} from "discord.js";
import { join } from "path";

const TRANSCRIPTS_DIR = join(import.meta.dir, "..", "transcripts");

export interface Session {
  /** The Discord thread where the full transcript and summary are posted at session end. */
  thread: AnyThreadChannel;
  /** AssemblyAI transcript IDs collected during the session. */
  transcriptIds: string[];
  /** Wall-clock ms when the session started. */
  startTime: number;
  /** Absolute path of the local backup file. */
  logFilePath: string;
  /** When true, voiceHandler drops incoming audio. */
  paused: boolean;
  /** Formatted transcript lines accumulated during the session, keyed by sort timestamp. */
  accumulatedLines: Array<{ sortKey: number; speaker: string; line: string }>;
}

let currentSession: Session | null = null;

/**
 * Creates a new Discord thread and initialises a session.
 * If a session is already running it is ended first.
 */
export async function startSession(textChannel: TextChannel): Promise<Session> {
  if (currentSession) {
    await endSession();
  }

  const now = new Date();
  // e.g. "2026-03-27_14-32-00"
  const dateStr = now
    .toISOString()
    .slice(0, 19)
    .replace("T", "_")
    .replace(/:/g, "-");

  const thread = await textChannel.threads.create({
    name: `Transcript ${dateStr}`,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
    reason: "Voice transcription session",
  });

  const logFilePath = join(TRANSCRIPTS_DIR, `${dateStr}.txt`);

  currentSession = {
    thread,
    transcriptIds: [],
    startTime: Date.now(),
    logFilePath,
    paused: false,
    accumulatedLines: [],
  };

  await thread.send(
    `🎙️ **Session started** — ${now.toLocaleTimeString()} — transcripts saved to \`${logFilePath}\``
  );
  console.log(`[session] Started. Thread: "${thread.name}", log: ${logFilePath}`);

  return currentSession;
}

/**
 * Generates a LeMUR summary, posts it to the thread, then archives the thread.
 */
export async function endSession(): Promise<void> {
  if (!currentSession) return;
  const session = currentSession;
  currentSession = null;

  const durationSec = Math.round((Date.now() - session.startTime) / 1000);
  console.log(
    `[session] Ending. Duration: ${durationSec}s, transcripts: ${session.transcriptIds.length}`
  );

  // Post the full accumulated transcript
  const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

  // Sort chronologically, then merge consecutive lines from the same speaker.
  // Lines are only merged when no other speaker appears between them — if speaker
  // B speaks between two of speaker A's chunks, A's chunks remain separate.
  const sorted = session.accumulatedLines.slice().sort((a, b) => a.sortKey - b.sortKey);

  const merged: Array<{ speaker: string; line: string }> = [];
  for (const entry of sorted) {
    const last = merged.length > 0 ? merged[merged.length - 1] : null;
    if (last !== null && last.speaker === entry.speaker) {
      // Same speaker — append text only, keep the first line's timestamp
      const textPart = entry.line.slice(entry.line.indexOf("**: ") + 4);
      const sep = CJK_RE.test(last.line) || CJK_RE.test(textPart) ? "" : " ";
      last.line += sep + textPart;
    } else {
      merged.push({ speaker: entry.speaker, line: entry.line });
    }
  }

  if (merged.length > 0) {
    await session.thread.send("📝 **Full Transcript**").catch(() => {});
    let batch = "";
    for (const { line } of merged) {
      const candidate = batch.length === 0 ? line : batch + "\n" + line;
      if (candidate.length > 1900) {
        await session.thread.send(batch).catch(() => {});
        batch = line;
      } else {
        batch = candidate;
      }
    }
    if (batch.length > 0) await session.thread.send(batch).catch(() => {});
  }

  const chunks = session.transcriptIds.length;
  await session.thread
    .send(`⏹️ **Session ended** — duration: ${durationSec}s, chunks transcribed: ${chunks}`)
    .catch(() => {});

  // Archive the thread so it doesn't clutter the channel
  await session.thread.setArchived(true).catch((err) => {
    console.warn("[session] Could not archive thread:", err);
  });
}

/** Returns the active session, or null if none is running. */
export function getSession(): Session | null {
  return currentSession;
}

/**
 * Returns true when no session is active or the session is paused.
 * voiceHandler uses this to gate audio recording.
 */
export function isPaused(): boolean {
  return currentSession?.paused ?? true;
}

export function pause(): void {
  if (currentSession) currentSession.paused = true;
}

export function resume(): void {
  if (currentSession) currentSession.paused = false;
}

/** Stores an AssemblyAI transcript ID for the end-of-session LeMUR call. */
export function addTranscriptId(id: string): void {
  if (currentSession && id) {
    currentSession.transcriptIds.push(id);
  }
}

/** Accumulates formatted transcript lines to be posted at session end. */
export function accumulateLines(sortKey: number, speaker: string, lines: string[]): void {
  if (!currentSession) return;
  for (const line of lines) {
    currentSession.accumulatedLines.push({ sortKey, speaker, line });
  }
}
