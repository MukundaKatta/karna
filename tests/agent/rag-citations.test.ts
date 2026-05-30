import { describe, it, expect } from "vitest";
import {
  buildCitations,
  renderMarker,
  renderReferences,
  attachCitations,
  type CitableChunk,
} from "../../agent/src/rag/citations.js";

function cc(
  id: string,
  source: string,
  content: string,
  score: number,
  span?: { start: number; end: number },
): CitableChunk {
  return {
    id,
    content,
    source,
    score,
    metadata: span ? { startOffset: span.start, endOffset: span.end } : {},
  };
}

describe("buildCitations", () => {
  it("assigns 1-based markers in input order and reads spans from metadata", () => {
    const cites = buildCitations([
      cc("s1#0", "s1", "first source content", 0.9, { start: 0, end: 20 }),
      cc("s2#0", "s2", "second source content", 0.8),
    ]);
    expect(cites[0].marker).toBe(1);
    expect(cites[1].marker).toBe(2);
    expect(cites[0].source).toBe("s1");
    expect(cites[0].span).toEqual({ start: 0, end: 20 });
    expect(cites[1].span).toBeNull();
    expect(cites[0].score).toBe(0.9);
  });

  it("truncates long snippets", () => {
    const cites = buildCitations([cc("a#0", "a", "x".repeat(500), 0.5)], { snippetLength: 20 });
    expect(cites[0].snippet.length).toBeLessThanOrEqual(20);
    expect(cites[0].snippet.endsWith("…")).toBe(true);
  });

  it("dedupes by source and widens the span", () => {
    const cites = buildCitations(
      [
        cc("s1#0", "s1", "part one", 0.9, { start: 0, end: 8 }),
        cc("s1#1", "s1", "part two", 0.95, { start: 10, end: 18 }),
        cc("s2#0", "s2", "other", 0.4),
      ],
      { dedupeBySource: true },
    );
    expect(cites).toHaveLength(2);
    const s1 = cites.find((c) => c.source === "s1")!;
    expect(s1.span).toEqual({ start: 0, end: 18 });
    expect(s1.score).toBe(0.95);
  });

  it("falls back to chunk id when no source given", () => {
    const cites = buildCitations([{ id: "lone", content: "hi" }]);
    expect(cites[0].source).toBe("lone");
  });
});

describe("renderMarker / renderReferences", () => {
  it("renders inline markers", () => {
    const cites = buildCitations([cc("a#0", "a", "hi", 0.5)]);
    expect(renderMarker(cites[0])).toBe("[1]");
  });
  it("renders a references block", () => {
    const refs = renderReferences(buildCitations([cc("src", "src", "snippet here", 0.5)]));
    expect(refs).toContain("[1] src");
    expect(refs).toContain("snippet here");
  });
});

describe("attachCitations", () => {
  it("appends a sources section", () => {
    const cites = buildCitations([cc("src", "src", "evidence text", 0.5)]);
    const res = attachCitations("The answer is 42.", cites);
    expect(res.text).toContain("The answer is 42.");
    expect(res.text).toContain("Sources:");
    expect(res.text).toContain("[1] src");
    expect(res.citations).toBe(cites);
  });

  it("returns the response unchanged when there are no citations", () => {
    expect(attachCitations("Answer.", []).text).toBe("Answer.");
  });
});
