import { describe, it, expect } from "vitest";
import {
  BM25,
  bm25Search,
  tokenize,
  fuse,
  hybridSearch,
  DEFAULT_FUSE_OPTIONS,
} from "../../agent/src/rag/hybrid.js";
import type { TextChunk } from "../../agent/src/rag/chunker.js";

function chunk(id: string, content: string): TextChunk {
  return { id, content, index: 0, tokenCount: Math.ceil(content.length / 4), metadata: {} };
}

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumeric", () => {
    expect(tokenize("Hello, World! foo_bar 123")).toEqual(["hello", "world", "foo", "bar", "123"]);
  });
  it("returns empty for blank input", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("BM25", () => {
  it("ranks documents containing query terms higher", () => {
    const index = new BM25();
    index.addAll([
      { id: "a", text: "the quick brown fox jumps over the lazy dog" },
      { id: "b", text: "a treatise on marine biology and whales" },
      { id: "c", text: "the lazy dog sleeps all day" },
    ]);
    expect(index.size).toBe(3);
    const ids = index.search("lazy dog", 10).map((r) => r.id);
    expect(ids).toContain("a");
    expect(ids).toContain("c");
    expect(ids).not.toContain("b");
  });

  it("rewards rarer terms via IDF", () => {
    const index = new BM25();
    index.addAll([
      { id: "common", text: "cat cat cat dog" },
      { id: "rare", text: "cat aardvark" },
    ]);
    expect(index.search("aardvark", 10)[0].id).toBe("rare");
  });

  it("returns nothing for a query with no matching terms", () => {
    const index = new BM25();
    index.add("a", "hello world");
    expect(index.search("zebra")).toEqual([]);
  });

  it("bm25Search convenience over chunks works", () => {
    const chunks = [chunk("d#0", "alpha beta"), chunk("d#1", "beta gamma delta")];
    expect(bm25Search(chunks, "gamma")[0].id).toBe("d#1");
  });
});

describe("fuse (RRF)", () => {
  it("combines two ranked lists and rewards items in both", () => {
    const vector = [{ id: "x" }, { id: "y" }, { id: "z" }];
    const lexical = [{ id: "y" }, { id: "w" }];
    const fused = fuse(vector, lexical);
    expect(fused[0].id).toBe("y");
    const y = fused.find((f) => f.id === "y")!;
    expect(y.vectorRank).toBe(1);
    expect(y.lexicalRank).toBe(0);
  });

  it("respects topK", () => {
    expect(fuse([{ id: "1" }, { id: "2" }, { id: "3" }], [], { topK: 2 })).toHaveLength(2);
  });

  it("applies weights", () => {
    const fusedLex = fuse([{ id: "v" }], [{ id: "l" }], { vectorWeight: 0, lexicalWeight: 1 });
    expect(fusedLex[0].id).toBe("l");
    expect(DEFAULT_FUSE_OPTIONS.k).toBe(60);
  });
});

describe("hybridSearch", () => {
  it("fuses a semantic ranking with a lexical BM25 ranking", () => {
    const chunks: TextChunk[] = [
      chunk("d#0", "photosynthesis converts light into energy"),
      chunk("d#1", "the mitochondria is the powerhouse"),
      chunk("d#2", "light reactions occur in the chloroplast"),
    ];
    const vectorRanking = [{ id: "d#1" }, { id: "d#0" }];
    const results = hybridSearch(vectorRanking, chunks, "light energy");
    expect(results.length).toBeGreaterThan(0);
    expect(typeof results[0].score).toBe("number");
    // d#0 matches both lexical and vector -> should surface near the top.
    expect(results.map((r) => r.id)).toContain("d#0");
  });
});
