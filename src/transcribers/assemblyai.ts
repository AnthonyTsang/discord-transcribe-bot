import { AssemblyAI } from "assemblyai";
import { config } from "../config.js";
import { getWords as getDbWordBoost } from "../wordBoostDb.js";
import type { Transcriber, TranscribeResult } from "../transcriber.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClient(): AssemblyAI {
  if (!config.assemblyAiKey) {
    throw new Error("ASSEMBLYAI_KEY is required when TRANSCRIBER=assemblyai");
  }
  return new AssemblyAI({ apiKey: config.assemblyAiKey });
}

export const assemblyAiTranscriber: Transcriber = {
  async transcribe(wav: Buffer, speaker?: string): Promise<TranscribeResult> {
    const client = createClient();
    const audioSec = ((wav.length - 44) / (2 * 2 * 48000)).toFixed(1);
    const tag = speaker ? `[transcriber/assemblyai] (${speaker})` : "[transcriber/assemblyai]";
    console.log(`${tag} Sending ${audioSec}s of audio (${(wav.length / 1024).toFixed(1)} KB)...`);

    let lastError: Error = new Error("Unknown error");

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const transcript = await client.transcripts.transcribe({
          audio: wav,
          punctuate: true,
          format_text: true,
          ...(config.assemblyAiLanguage ? { language_code: config.assemblyAiLanguage } : {}),
          ...(() => {
            const words = getDbWordBoost();
            return words.length > 0
              ? { word_boost: words, boost_param: "high" as const }
              : {};
          })(),
        });

        if (transcript.status === "error") {
          throw new Error(`AssemblyAI error: ${transcript.error}`);
        }

        if (!transcript.words || transcript.words.length === 0) {
          console.log(`${tag} No words in transcript.`);
          return { words: [], transcriptId: transcript.id };
        }

        const charCount = transcript.text?.length ?? 0;
        console.log(
          `${tag} Received transcript — ${transcript.words.length} words, ${charCount} chars (attempt ${attempt}).`
        );

        return {
          words: transcript.words.map((w) => ({
            text: w.text,
            start: w.start ?? 0,
            end: w.end ?? 0,
            confidence: w.confidence ?? 1,
          })),
          transcriptId: transcript.id,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(
            `[transcriber/assemblyai] Attempt ${attempt} failed: ${lastError.message}. Retrying in ${delay}ms...`
          );
          await sleep(delay);
        }
      }
    }

    throw lastError;
  },
};
