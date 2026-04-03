import { config } from "./config.js";

export interface TranscriptWord {
  text: string;
  /** ms relative to the start of the audio chunk */
  start: number;
  /** ms relative to the start of the audio chunk */
  end: number;
  confidence: number;
}

export interface TranscribeResult {
  words: TranscriptWord[];
  /** Backend-specific transcript ID (optional — not all backends provide one). */
  transcriptId?: string;
}

export interface Transcriber {
  transcribe(wav: Buffer, speaker?: string): Promise<TranscribeResult>;
}

function loadBackend(): Transcriber {
  switch (config.transcriber) {
    case "gcp": {
      const { gcpTranscriber } = require("./transcribers/gcp.js");
      return gcpTranscriber as Transcriber;
    }
    case "whisper": {
      const { whisperTranscriber } = require("./transcribers/whisper.js");
      return whisperTranscriber as Transcriber;
    }
    default: {
      const { assemblyAiTranscriber } = require("./transcribers/assemblyai.js");
      return assemblyAiTranscriber as Transcriber;
    }
  }
}

const backend: Transcriber = loadBackend();

/**
 * Transcribes a WAV buffer using the configured backend.
 * The public signature is unchanged — callers are unaffected by the backend swap.
 */
export function transcribe(wav: Buffer, speaker?: string): Promise<TranscribeResult> {
  return backend.transcribe(wav, speaker);
}
