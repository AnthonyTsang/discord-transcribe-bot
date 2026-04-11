# Design: Post End-of-Session Transcript as File Attachment

**Date:** 2026-04-03

## Context

At session end, the bot currently posts the full merged transcript as a series of Discord text messages (one `thread.send()` per merged chunk, batched to stay under Discord's 2000-char limit). For long sessions this produces many messages that clutter the thread. The goal is to replace these messages with a single `.txt` file attachment.

## Scope

- **In scope:** The end-of-session full transcript posting in `sessionManager.endSession()`
- **Out of scope:** Real-time per-chunk messages posted during the session (`poster.ts`, `chunkManager.ts`), the local on-disk log file (`transcriptLogger.ts`), session start/end summary messages

## Design

### What changes

`src/sessionManager.ts` — `endSession()` function only.

**Current behaviour:**
1. Sort and merge `accumulatedLines`
2. Send `"📝 **Full Transcript**"` as a standalone message
3. Loop through merged lines, batching into `thread.send(batch)` calls (≤1900 chars each)

**New behaviour:**
1. Sort and merge `accumulatedLines` (same logic, unchanged)
2. Join merged lines into a single string with `\n` separators
3. If non-empty, send one message with the transcript as a file attachment:
   ```ts
   await thread.send({
     content: "📝 **Full Transcript**",
     files: [{
       attachment: Buffer.from(content, "utf8"),
       name: path.basename(session.logFilePath),
     }],
   });
   ```
4. If empty (no lines transcribed), send nothing — same as current behaviour

### Filename

`path.basename(session.logFilePath)` — e.g. `2026-03-27_14-32-00.txt`. The date/time matches the session start time, which is already encoded in the log file path when the session is created.

### Discord.js API

`thread.send({ files: [...] })` is supported in discord.js v14 (already the project's version). No new imports or dependencies needed beyond `path` (already imported in `sessionManager.ts`).

### Messages that remain unchanged

- `🎙️ **Session started** — ...` (sent at session start)
- `⏹️ **Session ended** — duration: Xs, chunks transcribed: N` (sent at session end)

## Files Modified

| File | Change |
|---|---|
| `src/sessionManager.ts` | Replace multi-message transcript loop with single `thread.send({ files: [...] })` call |

No other files are modified.

## Verification

1. Start a session, speak a few sentences, end the session
2. Confirm the thread contains a single `.txt` file attachment named `YYYY-MM-DD_HH-MM-SS.txt`
3. Open the file — confirm it contains the merged, chronologically-sorted transcript lines
4. Confirm the `🎙️ Session started` and `⏹️ Session ended` messages are still present
5. Confirm real-time per-chunk messages during the session are unaffected
6. Start a session, end it immediately without speaking — confirm no file attachment is posted
