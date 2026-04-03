import { config } from "../config.js";
import type { Transcriber, TranscribeResult } from "../transcriber.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WhisperSegment {
  text: string;
  start: number; // seconds
  end: number;   // seconds
  avg_logprob?: number;
}

interface WhisperResponse {
  segments?: WhisperSegment[];
}

export const whisperTranscriber: Transcriber = {
  async transcribe(wav: Buffer, speaker?: string): Promise<TranscribeResult> {
    const tag = speaker ? `[transcriber/whisper] (${speaker})` : "[transcriber/whisper]";
    const audioSec = ((wav.length - 44) / (2 * 2 * 48000)).toFixed(1);
    console.log(`${tag} Sending ${audioSec}s of audio (${(wav.length / 1024).toFixed(1)} KB)...`);

    let lastError: Error = new Error("Unknown error");

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const form = new FormData();
        const arrayBuffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
        form.append("file", new Blob([arrayBuffer], { type: "audio/wav" }), "audio.wav");
        form.append("model", "Systran/faster-whisper-large-v3");
        form.append("response_format", "verbose_json");
        form.append("timestamp_granularities[]", "segment");
        if (config.whisperLanguage) {
          form.append("language", config.whisperLanguage);
        }
        if (config.whisperPrompt) {
          form.append("prompt", config.whisperPrompt);
        }

        const response = await fetch(`${config.whisperUrl}/v1/audio/transcriptions`, {
          method: "POST",
          body: form,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = (await response.json()) as WhisperResponse;
        // Use segments so punctuation is preserved in the text.
        // avg_logprob is in log-space (typically -0.5 to 0); convert to 0–1 range.
        const words = (data.segments ?? []).map((seg) => ({
          text: seg.text.trim(),
          start: Math.round(seg.start * 1000),
          end: Math.round(seg.end * 1000),
          confidence: seg.avg_logprob !== undefined ? Math.exp(seg.avg_logprob) : 1.0,
        }));

        console.log(`${tag} Received transcript — ${words.length} segments (attempt ${attempt}).`);
        return { words };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(
            `[transcriber/whisper] Attempt ${attempt} failed: ${lastError.message}. Retrying in ${delay}ms...`
          );
          await sleep(delay);
        }
      }
    }

    throw lastError;
  },
};
