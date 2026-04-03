import "dotenv/config";

export interface Config {
  discordToken: string;
  /** Which transcription backend to use. Default: "assemblyai". */
  transcriber: "assemblyai" | "gcp" | "whisper";
  /** Required when transcriber === "assemblyai". */
  assemblyAiKey: string | undefined;
  /** Required when transcriber === "gcp". Set GOOGLE_APPLICATION_CREDENTIALS in env for auth. */
  gcpProjectId: string | undefined;
  /** Optional guild ID used to register slash commands instantly.
   *  If omitted the bot derives it from the resolved voice/text channel,
   *  or falls back to global (slower) command registration. */
  guildId: string | undefined;
  minChunkMs: number;
  maxChunkMs: number;
  /** ISO 639-1 language code for AssemblyAI (e.g. "en", "fr"). */
  assemblyAiLanguage: string | undefined;
  /** BCP-47 language code for GCP Speech-to-Text (e.g. "en-US", "fr-FR"). */
  gcpLanguage: string | undefined;
  /** Whisper language code (e.g. "yue" for Cantonese, "zh" for Mandarin, "en" for English). */
  whisperLanguage: string | undefined;
  /** Optional prompt to guide Whisper's output style (e.g. encourage punctuation). */
  whisperPrompt: string | undefined;
  /** Base URL of the faster-whisper-server instance. */
  whisperUrl: string;
  minConfidence: number;
  /** RMS level below which a mixed audio chunk is considered silence and skipped.
   *  Set to 0 to disable silence detection. Range: 0–32767. */
  silenceRmsThreshold: number;
  healthPort: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const transcriber = (process.env.TRANSCRIBER ?? "assemblyai") as "assemblyai" | "gcp" | "whisper";

// Validate backend-specific required vars at startup
if (transcriber === "assemblyai" && !process.env.ASSEMBLYAI_KEY) {
  throw new Error("Missing required environment variable: ASSEMBLYAI_KEY (required when TRANSCRIBER=assemblyai)");
}

export const config: Config = Object.freeze({
  discordToken: requireEnv("DISCORD_TOKEN"),
  transcriber,
  assemblyAiKey: process.env.ASSEMBLYAI_KEY || undefined,
  gcpProjectId: process.env.GCP_PROJECT_ID || undefined,
  guildId: process.env.GUILD_ID || undefined,
  minChunkMs: parseInt(process.env.MIN_CHUNK_MS ?? "5000", 10),
  maxChunkMs: parseInt(process.env.MAX_CHUNK_MS ?? "60000", 10),
  assemblyAiLanguage: process.env.ASSEMBLYAI_LANGUAGE || undefined,
  gcpLanguage: process.env.GCP_LANGUAGE || undefined,
  whisperLanguage: process.env.WHISPER_LANGUAGE || undefined,
  whisperPrompt: process.env.WHISPER_PROMPT || undefined,
  whisperUrl: process.env.WHISPER_URL || "http://whisper:8000",
  minConfidence: parseFloat(process.env.MIN_CONFIDENCE ?? "0.4"),
  silenceRmsThreshold: parseInt(process.env.SILENCE_THRESHOLD ?? "200", 10),
  healthPort: parseInt(process.env.HEALTH_PORT ?? "3000", 10),
});
