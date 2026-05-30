import { describe, it, expect } from "vitest";
import {
  compareTranscripts,
  maskValue,
  serializeGolden,
  DEFAULT_MASK_FIELDS,
  type Transcript,
} from "../../agent/src/evals/golden.js";

const golden: Transcript = {
  turns: [
    { role: "user", content: "hi", id: "abc", timestamp: 111 },
    { role: "assistant", content: "hello", id: "def", latencyMs: 50 },
  ],
  metadata: { sessionId: "s-1" },
};

describe("golden transcript snapshots", () => {
  it("matches when only masked nondeterministic fields differ", () => {
    const candidate: Transcript = {
      turns: [
        { role: "user", content: "hi", id: "zzz", timestamp: 999 },
        { role: "assistant", content: "hello", id: "qqq", latencyMs: 7000 },
      ],
      metadata: { sessionId: "s-99" },
    };
    const cmp = compareTranscripts(golden, candidate, { fields: DEFAULT_MASK_FIELDS });
    expect(cmp.match).toBe(true);
    expect(cmp.diffs).toHaveLength(0);
  });

  it("detects real content divergence", () => {
    const candidate: Transcript = {
      turns: [
        { role: "user", content: "hi", id: "x", timestamp: 1 },
        { role: "assistant", content: "GOODBYE", id: "y", latencyMs: 1 },
      ],
      metadata: { sessionId: "s-2" },
    };
    const cmp = compareTranscripts(golden, candidate, { fields: DEFAULT_MASK_FIELDS });
    expect(cmp.match).toBe(false);
    const diff = cmp.diffs.find((d) => d.path.includes("content"));
    expect(diff?.expected).toBe("hello");
    expect(diff?.actual).toBe("GOODBYE");
  });

  it("masks via regex patterns", () => {
    const masked = maskValue(
      { uuid: "550e8400-e29b-41d4-a716-446655440000", keep: "hi" },
      { patterns: [/^[0-9a-f-]{36}$/] },
    ) as Record<string, unknown>;
    expect(masked.uuid).toBe("<MASKED>");
    expect(masked.keep).toBe("hi");
  });

  it("serializeGolden is deterministic regardless of key order", () => {
    const a: Transcript = { turns: [{ role: "user", content: "x", b: 1, a: 2 }] };
    const b: Transcript = { turns: [{ content: "x", role: "user", a: 2, b: 1 }] };
    expect(serializeGolden(a)).toBe(serializeGolden(b));
  });

  it("detects array length divergence", () => {
    const candidate: Transcript = {
      turns: [{ role: "user", content: "hi", id: "x", timestamp: 1 }],
      metadata: { sessionId: "s" },
    };
    const cmp = compareTranscripts(golden, candidate, { fields: DEFAULT_MASK_FIELDS });
    expect(cmp.match).toBe(false);
    expect(cmp.diffs.some((d) => d.path.includes("length"))).toBe(true);
  });
});
