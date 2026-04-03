/**
 * Per-user PCM buffer management.
 * Replaces audioMixer.ts — instead of blending all speakers into one track,
 * each user's audio is kept isolated so it can be uploaded to AssemblyAI
 * independently, giving us perfect speaker attribution at zero extra cost.
 */

// Audio constants for Discord voice (48 kHz stereo 16-bit PCM)
const SAMPLE_RATE    = 48000;
const CHANNELS       = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_FRAME  = CHANNELS * BYTES_PER_SAMPLE; // 4
const BYTES_PER_MS     = (SAMPLE_RATE * BYTES_PER_FRAME) / 1000; // 192

// Volume normalization constants (same as the old mixer)
const TARGET_RMS = 3000;
const MIN_RMS    = 100;
const MAX_GAIN   = 4.0;
const MIN_GAIN   = 0.25;

interface UserBuffer {
  pcm: Buffer;
  /** Wall-clock ms when the first packet arrived for this speaking turn. */
  startMs: number;
}

const buffers = new Map<string, UserBuffer>();

// ── Internal helpers ──────────────────────────────────────────────────────────

function computeRms(buf: Buffer): number {
  const n = Math.floor(buf.length / 2);
  if (n === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const s = buf.readInt16LE(i);
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / n);
}

function normalizeVolume(pcm: Buffer): Buffer {
  const rms = computeRms(pcm);
  if (rms < MIN_RMS) return pcm; // silence — don't amplify noise
  const gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_RMS / rms));
  if (Math.abs(gain - 1.0) < 0.05) return pcm; // already close to target
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const s = pcm.readInt16LE(i);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * gain))), i);
  }
  return out;
}

function buildWavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * BYTES_PER_FRAME;
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);                     // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(BYTES_PER_FRAME, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Appends a decoded PCM packet to the user's individual buffer.
 * Volume is normalized before appending so quiet speakers are amplified
 * to a consistent level before reaching AssemblyAI.
 */
export function writePcm(userId: string, pcm: Buffer, wallClockMs: number): void {
  const normalized = normalizeVolume(pcm);
  let buf = buffers.get(userId);
  if (!buf) {
    buf = { pcm: Buffer.alloc(0), startMs: wallClockMs };
    buffers.set(userId, buf);
  }
  buf.pcm = Buffer.concat([buf.pcm, normalized]);
}

/** How many ms of audio are buffered for a specific user. */
export function getUserBufferedMs(userId: string): number {
  const buf = buffers.get(userId);
  return buf && buf.pcm.length > 0 ? buf.pcm.length / BYTES_PER_MS : 0;
}

/** Maximum buffered ms across all users (used by /status). */
export function getTotalBufferedMs(): number {
  let max = 0;
  for (const [id] of buffers) max = Math.max(max, getUserBufferedMs(id));
  return max;
}

/** RMS of a user's current buffer (used for silence detection). */
export function getUserRms(userId: string): number {
  const buf = buffers.get(userId);
  return buf ? computeRms(buf.pcm) : 0;
}

/**
 * Exports a user's buffer as a WAV file along with the absolute wall-clock
 * start time of their recording, then clears their buffer.
 * Returns null if the user has no buffered data.
 */
export function flushUserWav(userId: string): { wav: Buffer; startMs: number } | null {
  const buf = buffers.get(userId);
  if (!buf || buf.pcm.length === 0) return null;
  const wav = Buffer.concat([buildWavHeader(buf.pcm.length), buf.pcm]);
  buffers.delete(userId);
  return { wav, startMs: buf.startMs };
}

/** Discards a user's buffer without uploading (e.g. silence detection). */
export function resetUser(userId: string): void {
  buffers.delete(userId);
}

/** Discards all users' buffers (called on new session). */
export function resetAll(): void {
  buffers.clear();
}

/** Returns IDs of all users that currently have buffered audio. */
export function getBufferedUserIds(): string[] {
  return [...buffers.keys()].filter((id) => getUserBufferedMs(id) > 0);
}
