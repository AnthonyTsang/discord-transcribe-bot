import { SpeechClient } from "@google-cloud/speech";
import type { protos } from "@google-cloud/speech";
import { config } from "../config.js";
import { getWords as getDbWordBoost } from "../wordBoostDb.js";
import type { Transcriber, TranscribeResult } from "../transcriber.js";

type RecognitionWord = protos.google.cloud.speech.v1.IWordInfo;

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GCP synchronous recognize limit. Leave 1s margin below the 60s hard cap. */
const GCP_MAX_AUDIO_MS = 59_000;

/**
 * Downsamples 48kHz stereo 16-bit PCM WAV to 16kHz mono 16-bit PCM WAV,
 * capping at GCP_MAX_AUDIO_MS to stay within the synchronous recognize limit.
 * Reduces file size by 6x. Uses averaging over 3-frame windows to minimise aliasing.
 */
function resampleTo16kMono(wav: Buffer): Buffer {
  const pcm = wav.subarray(44); // strip WAV header
  const RATIO = 3; // 48000 / 16000
  const inputFrames = Math.floor(pcm.length / 4); // 2 bytes/sample × 2 channels
  const maxOutputFrames = Math.floor((GCP_MAX_AUDIO_MS / 1000) * 16000);
  const outputFrames = Math.min(Math.floor(inputFrames / RATIO), maxOutputFrames);
  const output = Buffer.alloc(outputFrames * 2); // 2 bytes/sample × 1 channel

  for (let i = 0; i < outputFrames; i++) {
    // Average RATIO consecutive stereo frames into one mono sample
    let sum = 0;
    for (let j = 0; j < RATIO; j++) {
      const offset = (i * RATIO + j) * 4;
      const left = pcm.readInt16LE(offset);
      const right = pcm.readInt16LE(offset + 2);
      sum += (left + right) / 2; // stereo → mono
    }
    output.writeInt16LE(Math.round(sum / RATIO), i * 2);
  }

  // Build a new WAV header for 16kHz mono 16-bit PCM
  const header = Buffer.alloc(44);
  const dataSize = output.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);        // PCM chunk size
  header.writeUInt16LE(1, 20);         // PCM format
  header.writeUInt16LE(1, 22);         // 1 channel (mono)
  header.writeUInt32LE(16000, 24);     // 16kHz sample rate
  header.writeUInt32LE(16000 * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);         // block align
  header.writeUInt16LE(16, 34);        // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, output]);
}

/** Converts a GCP Duration object ({ seconds, nanos }) to milliseconds. */
function durationToMs(d: { seconds?: string | number | Long | null; nanos?: number | null } | null | undefined): number {
  if (!d) return 0;
  return Number(d.seconds ?? 0) * 1000 + Math.round((d.nanos ?? 0) / 1_000_000);
}

let _client: SpeechClient | null = null;
function getClient(): SpeechClient {
  if (!_client) {
    const raw = process.env.GCP_CREDENTIALS_JSON;
    if (raw) {
      // Inline JSON credentials — no key file needed
      _client = new SpeechClient({ credentials: JSON.parse(raw) });
    } else {
      // Fall back to GOOGLE_APPLICATION_CREDENTIALS file or ADC
      _client = new SpeechClient();
    }
  }
  return _client;
}

export const gcpTranscriber: Transcriber = {
  async transcribe(wav: Buffer, speaker?: string): Promise<TranscribeResult> {
    const tag = speaker ? `[transcriber/gcp] (${speaker})` : "[transcriber/gcp]";
    const resampled = resampleTo16kMono(wav);
    const pcm = resampled.subarray(44); // strip header for inline content
    const audioSec = (pcm.length / (1 * 2 * 16000)).toFixed(1);
    console.log(`${tag} Sending ${audioSec}s of audio (${(pcm.length / 1024).toFixed(1)} KB, resampled to 16kHz mono)...`);

    const boostWords = getDbWordBoost();

    let lastError: Error = new Error("Unknown error");

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const [response] = await getClient().recognize({
          config: {
            encoding: "LINEAR16",
            sampleRateHertz: 16000,
            audioChannelCount: 1,
            languageCode: config.gcpLanguage ?? "en-US",
            enableWordTimeOffsets: true,
            enableWordConfidence: true,
            enableAutomaticPunctuation: true,
            ...(boostWords.length > 0
              ? { speechContexts: [{ phrases: boostWords, boost: 20 }] }
              : {}),
          },
          audio: { content: pcm.toString("base64") },
        });

        const results = response.results ?? [];
        const words = results.flatMap((r) =>
          ((r.alternatives?.[0]?.words ?? []) as RecognitionWord[]).map((w) => ({
            text: w.word ?? "",
            start: durationToMs(w.startTime),
            end: durationToMs(w.endTime),
            confidence: w.confidence ?? 1,
          }))
        );

        console.log(`${tag} Received transcript — ${words.length} words (attempt ${attempt}).`);
        return { words };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(
            `[transcriber/gcp] Attempt ${attempt} failed: ${lastError.message}. Retrying in ${delay}ms...`
          );
          await sleep(delay);
        }
      }
    }

    throw lastError;
  },
};
