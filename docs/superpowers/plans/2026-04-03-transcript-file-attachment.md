# Transcript File Attachment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-message end-of-session transcript posting with a single `.txt` file attachment in the Discord thread.

**Architecture:** Modify `endSession()` in `sessionManager.ts` to build the merged transcript as an in-memory string and upload it via `thread.send({ files: [...] })` instead of looping over `thread.send(batch)` calls. No other files change.

**Tech Stack:** discord.js v14 (`thread.send({ files })` API), Node.js `path.basename`, Bun/TypeScript.

---

### Task 1: Replace transcript messages with file attachment

**Files:**
- Modify: `src/sessionManager.ts`

- [ ] **Step 1: Add `basename` to the path import**

In `src/sessionManager.ts`, line 6, change:

```ts
import { join } from "path";
```

to:

```ts
import { join, basename } from "path";
```

- [ ] **Step 2: Replace the multi-message loop with a single file attachment send**

In `src/sessionManager.ts`, find and replace the block starting at `if (merged.length > 0)` (currently around line 103):

**Remove this:**
```ts
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
```

**Replace with:**
```ts
  if (merged.length > 0) {
    const content = merged.map(({ line }) => line).join("\n");
    await session.thread
      .send({
        content: "📝 **Full Transcript**",
        files: [{ attachment: Buffer.from(content, "utf8"), name: basename(session.logFilePath) }],
      })
      .catch(() => {});
  }
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run existing tests to confirm nothing broke**

```bash
bun test
```

Expected: 67 pass, 0 fail (no sessionManager unit tests exist; the chunkManager tests mock sessionManager at the interface level and are unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/sessionManager.ts
git commit -m "feat: post end-of-session transcript as txt file attachment"
```

---

## Verification (manual)

1. Start a session (`/join` → `/startsession`), speak a few sentences, end with `/endsession`
2. In the Discord thread: confirm a single `.txt` file attachment named e.g. `2026-04-03_14-32-00.txt` is present alongside the "📝 **Full Transcript**" message
3. Download and open the file — confirm it contains chronologically-sorted, speaker-merged transcript lines
4. Confirm the `🎙️ Session started` and `⏹️ Session ended` messages are still present and unchanged
5. Confirm real-time per-chunk messages during the session are unaffected
6. Start and immediately end a session without speaking — confirm no file attachment is posted
