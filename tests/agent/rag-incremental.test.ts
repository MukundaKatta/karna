import { describe, it, expect } from "vitest";
import {
  diffChunks,
  diffDocuments,
  ensureHash,
  hasChanges,
  chunksToUpsert,
  toIndexRecords,
  type HashedChunk,
} from "../../agent/src/rag/incremental.js";
import { ingestDocument, contentHash } from "../../agent/src/rag/ingestion.js";
import type { TextChunk } from "../../agent/src/rag/chunker.js";

function hc(id: string, hash: string): HashedChunk {
  return { id, contentHash: hash };
}

function tc(id: string, content: string): TextChunk {
  return { id, content, index: 0, tokenCount: Math.ceil(content.length / 4), metadata: {} };
}

describe("ensureHash", () => {
  it("computes a hash from content when absent", () => {
    expect(ensureHash(tc("a", "hello")).contentHash).toBe(contentHash("hello"));
  });
  it("keeps an existing hash", () => {
    expect(ensureHash({ ...tc("a", "hello"), contentHash: "preset" }).contentHash).toBe("preset");
  });
});

describe("diffChunks", () => {
  it("detects added, updated, deleted, unchanged", () => {
    const previous = [hc("a", "h1"), hc("b", "h2"), hc("c", "h3")];
    const next = [hc("a", "h1"), hc("b", "h2-new"), hc("d", "h4")];
    const change = diffChunks(previous, next);
    expect(change.unchanged).toEqual(["a"]);
    expect(change.updated.map((c) => c.id)).toEqual(["b"]);
    expect(change.added.map((c) => c.id)).toEqual(["d"]);
    expect(change.deleted).toEqual(["c"]);
  });

  it("treats an empty previous index as all-added", () => {
    const change = diffChunks([], [hc("a", "h")]);
    expect(change.added).toHaveLength(1);
    expect(change.deleted).toHaveLength(0);
  });

  it("treats empty next as all-deleted", () => {
    expect(diffChunks([hc("a", "h")], []).deleted).toEqual(["a"]);
  });
});

describe("diffDocuments", () => {
  it("hashes plain TextChunks before diffing", () => {
    const previous = [hc("d#0", contentHash("old text"))];
    const change = diffDocuments(previous, [tc("d#0", "new text")]);
    expect(change.updated.map((c) => c.id)).toEqual(["d#0"]);
  });

  it("integrates with ingestDocument for incremental re-index", () => {
    const v1 = ingestDocument("doc", "Alpha beta. Gamma delta.", { strategy: "sentences", chunkSize: 20, overlap: 0 });
    const snapshot = toIndexRecords(v1.chunks);

    const v1again = ingestDocument("doc", "Alpha beta. Gamma delta.", { strategy: "sentences", chunkSize: 20, overlap: 0 });
    expect(hasChanges(diffChunks(snapshot, v1again.chunks))).toBe(false);

    const v2 = ingestDocument("doc", "Alpha beta. Gamma EPSILON.", { strategy: "sentences", chunkSize: 20, overlap: 0 });
    const change = diffChunks(snapshot, v2.chunks);
    expect(hasChanges(change)).toBe(true);
    expect(chunksToUpsert(change).length).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it("hasChanges is false for an empty change set", () => {
    expect(hasChanges({ added: [], updated: [], deleted: [], unchanged: [] })).toBe(false);
  });
  it("chunksToUpsert combines added and updated", () => {
    const change = { added: [hc("a", "h")], updated: [hc("b", "h")], deleted: [], unchanged: [] };
    expect(chunksToUpsert(change).map((c) => c.id)).toEqual(["a", "b"]);
  });
  it("toIndexRecords projects id and hash only", () => {
    expect(toIndexRecords([{ id: "a", contentHash: "h", extra: 1 } as HashedChunk])).toEqual([
      { id: "a", contentHash: "h" },
    ]);
  });
});
