import { describe, it, expect } from "vitest";
import {
  ingestDocument,
  extractMetadata,
  contentHash,
  splitIntoSentences,
  splitIntoParagraphs,
  DEFAULT_INGESTION_OPTIONS,
} from "../../agent/src/rag/ingestion.js";

const SAMPLE =
  "The Sun is a star. It is bright and hot. The Moon orbits the Earth and reflects light.";

describe("contentHash", () => {
  it("is stable and deterministic", () => {
    expect(contentHash("hello")).toBe(contentHash("hello"));
  });
  it("differs for different content", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
  it("produces a hex sha256 (64 chars)", () => {
    expect(contentHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("splitters", () => {
  it("splits sentences", () => {
    expect(splitIntoSentences(SAMPLE)).toHaveLength(3);
  });
  it("splits paragraphs", () => {
    expect(splitIntoParagraphs("one\n\ntwo\n\nthree")).toHaveLength(3);
  });
  it("returns empty for blank text", () => {
    expect(splitIntoSentences("  ")).toEqual([]);
    expect(splitIntoParagraphs("")).toEqual([]);
  });
});

describe("extractMetadata", () => {
  it("counts words, sentences, paragraphs and guesses language", () => {
    const meta = extractMetadata(SAMPLE);
    expect(meta.charCount).toBe(SAMPLE.length);
    expect(meta.wordCount).toBeGreaterThan(0);
    expect(meta.sentenceCount).toBe(3);
    expect(meta.language).toBe("en");
  });
  it("extracts a title from a short first line", () => {
    expect(extractMetadata("My Title\n\nBody text here.").title).toBe("My Title");
  });
  it("merges extra metadata", () => {
    expect(extractMetadata("hi", { url: "http://x" }).url).toBe("http://x");
  });
  it("handles empty input", () => {
    const meta = extractMetadata("");
    expect(meta.wordCount).toBe(0);
    expect(meta.language).toBe("unknown");
  });
});

describe("ingestDocument", () => {
  it("produces hashed chunks with a document hash (recursive default)", () => {
    const result = ingestDocument("doc1", SAMPLE);
    expect(result.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.chunks.length).toBeGreaterThan(0);
    for (const c of result.chunks) {
      expect(c.contentHash).toBe(contentHash(c.content));
      expect(c.id.startsWith("doc1#")).toBe(true);
      expect(c.metadata.documentHash).toBe(result.documentHash);
    }
  });

  it("is idempotent for identical input", () => {
    const a = ingestDocument("doc1", SAMPLE);
    const b = ingestDocument("doc1", SAMPLE);
    expect(a.documentHash).toBe(b.documentHash);
    expect(a.chunks.map((c) => c.contentHash)).toEqual(b.chunks.map((c) => c.contentHash));
  });

  it("supports sentence strategy", () => {
    const result = ingestDocument("s", SAMPLE, { strategy: "sentences", chunkSize: 30, overlap: 0 });
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it("supports paragraph strategy", () => {
    const text = "Para one sentence.\n\nPara two has different content entirely.";
    const result = ingestDocument("p", text, { strategy: "paragraphs", chunkSize: 20, overlap: 0 });
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it("supports token strategy with overlap and char offsets in metadata", () => {
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const result = ingestDocument("tok", text, {
      strategy: "tokens",
      chunkSize: 10,
      overlap: 2,
    });
    expect(result.chunks.length).toBeGreaterThan(1);
    for (const c of result.chunks) {
      const start = c.metadata.startOffset as number;
      const end = c.metadata.endOffset as number;
      expect(text.slice(start, end)).toBe(c.content);
    }
  });

  it("can skip metadata extraction", () => {
    expect(ingestDocument("d", SAMPLE, { extractMetadata: false }).metadata.wordCount).toBe(0);
  });

  it("exposes sane defaults", () => {
    expect(DEFAULT_INGESTION_OPTIONS.strategy).toBe("recursive");
    expect(DEFAULT_INGESTION_OPTIONS.extractMetadata).toBe(true);
  });
});
