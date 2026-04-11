import { mock, describe, it, expect } from "bun:test";

// Must mock config BEFORE importing poster (which loads config.ts at module level).
// mock.module intercepts subsequent dynamic imports.
mock.module("../../src/config.js", () => ({
  config: { minConfidence: 0.4 },
}));

// Use dynamic imports so the mocks are in place before modules execute.
const { buildTranscriptLines, postLines } = await import("../poster.js");

import type { TranscriptWord } from "../transcriber.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function word(text: string, confidence: number, start = 0, end = 500): TranscriptWord {
  return { text, confidence, start, end };
}

// Mirrors poster.ts formatTimestamp so tests are timezone-agnostic
function expectedTimestamp(absoluteMs: number): string {
  const d = new Date(absoluteMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}]`;
}

// ---------------------------------------------------------------------------
// confidence filtering (minConfidence = 0.4)
// ---------------------------------------------------------------------------

describe("buildTranscriptLines — confidence filtering", () => {
  it("returns [] when all words are below minConfidence", () => {
    const words: TranscriptWord[] = [
      word("hello", 0.1),
      word("world", 0.39),
    ];
    expect(buildTranscriptLines(words, "Alice", 0)).toEqual([]);
  });

  it("only includes words at or above minConfidence", () => {
    const words: TranscriptWord[] = [
      word("bad", 0.3),
      word("good", 0.5),
    ];
    const lines = buildTranscriptLines(words, "Alice", 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("good");
    expect(lines[0]).not.toContain("bad");
  });
});

// ---------------------------------------------------------------------------
// CJK joining logic
// ---------------------------------------------------------------------------

describe("buildTranscriptLines — CJK joining", () => {
  it("joins two CJK words with no space", () => {
    const words: TranscriptWord[] = [
      word("世界", 1.0),
      word("和平", 1.0),
    ];
    const lines = buildTranscriptLines(words, "Alice", 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("世界和平");
  });

  it("joins Latin followed by CJK with no space", () => {
    const words: TranscriptWord[] = [
      word("hello", 1.0),
      word("世界", 1.0),
    ];
    const lines = buildTranscriptLines(words, "Alice", 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hello世界");
  });

  it("joins two Latin words with a space", () => {
    const words: TranscriptWord[] = [
      word("hello", 1.0),
      word("world", 1.0),
    ];
    const lines = buildTranscriptLines(words, "Alice", 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hello world");
  });
});

// ---------------------------------------------------------------------------
// timestamp formatting
// ---------------------------------------------------------------------------

describe("buildTranscriptLines — timestamp formatting", () => {
  it("formats a 1-hour offset correctly", () => {
    const chunkStartMs = 0;
    const wordStart = 3_600_000; // 1 hour in ms
    const words: TranscriptWord[] = [word("test", 1.0, wordStart)];
    const lines = buildTranscriptLines(words, "Alice", chunkStartMs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(expectedTimestamp(chunkStartMs + wordStart));
  });

  it("formats a zero offset correctly", () => {
    const chunkStartMs = 0;
    const words: TranscriptWord[] = [word("test", 1.0, 0)];
    const lines = buildTranscriptLines(words, "Alice", chunkStartMs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(expectedTimestamp(0));
  });
});

// ---------------------------------------------------------------------------
// line splitting at 2000 chars
// ---------------------------------------------------------------------------

describe("buildTranscriptLines — 2000-char splitting", () => {
  it("splits into multiple lines when content exceeds 1900 chars", () => {
    // Each word is 100 chars; 20 words = 2000 chars of content alone,
    // which exceeds maxContent (2000 - prefix.length ~= 1980).
    const longText = "a".repeat(100);
    const words: TranscriptWord[] = Array.from({ length: 20 }, () =>
      word(longText, 1.0)
    );
    const speaker = "TestUser";
    const lines = buildTranscriptLines(words, speaker, 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Every line must start with the speaker prefix pattern
    const prefixRe = /^\[\d{2}:\d{2}:\d{2}\] \*\*TestUser\*\*: /;
    for (const line of lines) {
      expect(line).toMatch(prefixRe);
    }
  });
});

// ---------------------------------------------------------------------------
// postLines
// ---------------------------------------------------------------------------

describe("postLines", () => {
  it("calls send once per line with the correct content", async () => {
    const calls: string[] = [];
    const stub = {
      send: async (content: string) => {
        calls.push(content);
        return undefined;
      },
    };

    const lines = ["line one", "line two", "line three"];
    await postLines(lines, stub);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe("line one");
    expect(calls[1]).toBe("line two");
    expect(calls[2]).toBe("line three");
  });

  it("never calls send when given an empty array", async () => {
    let callCount = 0;
    const stub = {
      send: async (_content: string) => {
        callCount++;
        return undefined;
      },
    };

    await postLines([], stub);
    expect(callCount).toBe(0);
  });
});
