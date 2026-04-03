import type { TranscriptWord } from "./transcriber.js";
import { config } from "./config.js";

/** Duck-typed to accept both TextChannel and ThreadChannel. */
type Postable = { send(content: string): Promise<unknown> };

/** Returns true if the text contains CJK (Chinese/Japanese) characters. */
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
function hasCJK(text: string): boolean {
  return CJK_RE.test(text);
}

/** Returns the separator to use when appending nextWord after prevText. */
function separator(prevText: string, nextWord: string): string {
  return hasCJK(prevText) || hasCJK(nextWord) ? "" : " ";
}

/** Formats a wall-clock ms timestamp as [HH:MM:SS]. */
function formatTimestamp(absoluteMs: number): string {
  const d = new Date(absoluteMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}]`;
}

/**
 * Builds formatted transcript lines for a single speaker's chunk.
 * Because each upload belongs to exactly one user, no speaker-detection
 * heuristics are needed — the attribution is 100% accurate.
 *
 * Output format:  `[HH:MM] **DisplayName**: words words words…`
 * Long chunks are split at word boundaries to stay under Discord's 2000-char limit.
 *
 * @param words         Word-level results from AssemblyAI (timestamps relative to chunk start)
 * @param speaker       Server display name of the speaker
 * @param chunkStartMs  Wall-clock ms when this user's recording started (drives [HH:MM])
 */
export function buildTranscriptLines(
  words: TranscriptWord[],
  speaker: string,
  chunkStartMs: number
): string[] {
  const filtered = words.filter((w) => w.confidence >= config.minConfidence);
  if (filtered.length === 0) return [];

  // Timestamp is derived from the first word's start offset into the recording
  const timestamp = formatTimestamp(chunkStartMs + (filtered[0].start ?? 0));
  const prefix = `${timestamp} **${speaker}**: `;
  const maxContent = 2000 - prefix.length;

  const lines: string[] = [];
  let chunk = "";

  for (const word of filtered) {
    const candidate = chunk.length === 0 ? word.text : chunk + separator(chunk, word.text) + word.text;
    if (candidate.length > maxContent) {
      if (chunk.length > 0) lines.push(prefix + chunk);
      chunk = word.text;
    } else {
      chunk = candidate;
    }
  }
  if (chunk.length > 0) lines.push(prefix + chunk);

  return lines;
}

/** Posts an array of pre-formatted lines to a channel or thread. */
export async function postLines(lines: string[], channel: Postable): Promise<void> {
  for (const line of lines) {
    await channel.send(line);
  }
}
