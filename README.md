# discord-transcribe-baby

A Discord bot that joins a voice channel, transcribes speech in real time, and posts speaker-attributed transcripts to a text channel thread.

## Features

- Per-user audio capture via Discord's individual audio streams (no diarization API needed)
- Multiple transcription backends: **AssemblyAI**, **Google Cloud Speech-to-Text**, **Whisper** (local GPU)
- Sessions with start/end, pause/resume, and auto-generated summaries
- Word-boost list for improved accuracy on domain-specific terms
- Access control (per-role and per-user)
- Per-user muting
- HTTP health check endpoint
- Docker Compose support (including optional local Whisper GPU service)

## Slash Commands

| Command | Description |
|---|---|
| `/setchannel voice` | Set the voice channel to record |
| `/setchannel text` | Set the text channel for transcript output |
| `/join` | Join the configured voice channel |
| `/leave` | Leave the voice channel (ends any active session) |
| `/startsession` | Start a transcription session |
| `/endsession` | End the session and generate a summary |
| `/pause` | Pause transcription (bot stays in channel) |
| `/resume` | Resume transcription |
| `/status` | Show current bot status |
| `/wordboost add\|remove\|list` | Manage the word-boost list |
| `/allowrole add\|remove\|list` | Manage roles permitted to use the bot |
| `/allowuser add\|remove\|list` | Manage users permitted to use the bot |
| `/mute` | Prevent a user's audio from being recorded |
| `/unmute` | Allow a muted user's audio again |

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- A Discord bot token with the **Guilds** and **Guild Voice States** intents enabled
- An API key for your chosen transcription backend

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in at minimum:

```env
DISCORD_TOKEN=your_discord_bot_token_here
TRANSCRIBER=assemblyai          # assemblyai | gcp | whisper
ASSEMBLYAI_KEY=your_key_here    # if using AssemblyAI
GUILD_ID=your_server_id         # recommended for instant slash command registration
```

See `.env.example` for all available options.

### 3. Run

```bash
bun run start
```

## Docker

```bash
cp .env.example .env
# fill in .env
docker compose up -d
```

For local Whisper (requires an NVIDIA GPU and `nvidia-container-toolkit`):

```env
TRANSCRIBER=whisper
WHISPER_URL=http://whisper:8000
```

The `whisper` service in `docker-compose.yml` downloads `faster-whisper-large-v3` and serves it on port 8000.

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `DISCORD_TOKEN` | — | **Required.** Discord bot token |
| `TRANSCRIBER` | `assemblyai` | Backend: `assemblyai`, `gcp`, or `whisper` |
| `ASSEMBLYAI_KEY` | — | AssemblyAI API key |
| `GCP_CREDENTIALS_JSON` | — | GCP service account JSON (inline) |
| `GCP_PROJECT_ID` | — | GCP project ID |
| `GUILD_ID` | — | Discord server ID for instant command registration |
| `MIN_CHUNK_MS` | `5000` | Minimum audio before a speaker-switch flush (ms) |
| `MAX_CHUNK_MS` | `60000` | Hard flush interval (ms) |
| `ASSEMBLYAI_LANGUAGE` | auto | ISO 639-1 language code (e.g. `en`) |
| `GCP_LANGUAGE` | `en-US` | BCP-47 language code |
| `WHISPER_URL` | `http://whisper:8000` | Whisper server URL |
| `WHISPER_LANGUAGE` | auto | Whisper language code |
| `WHISPER_PROMPT` | — | Prompt to guide Whisper transcription style |
| `MIN_CONFIDENCE` | `0.4` | Drop words below this confidence score (0–1) |
| `SILENCE_THRESHOLD` | `200` | RMS below this discards chunks without transcribing (0 = disabled) |
| `HEALTH_PORT` | `3000` | Port for the HTTP health check (`GET /` → 200 JSON) |
