// ─── Episodic vs Semantic Memory Tests (Issue #540) ──────────────────────────

import { describe, it, expect } from "vitest";
import type { MemoryEntry } from "@karna/shared/types/memory.js";
import {
  memoryTypeTag,
  explicitMemoryType,
  inferMemoryType,
  withMemoryTypeTag,
  filterByMemoryType,
  retrieveEpisodic,
  retrieveSemantic,
  consolidateEpisodicToSemantic,
} from "../../agent/src/memory/memory-types.js";

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = 1_000_000;
  return {
    id: overrides.id ?? "m1",
    content: "content",
    source: "conversation",
    priority: "normal",
    tags: [],
    relatedMessageIds: [],
    relatedMemoryIds: [],
    createdAt: now,
    updatedAt: now,
    accessedAt: now,
    accessCount: 0,
    decayFactor: 1,
    ...overrides,
  };
}

describe("memory-type classification", () => {
  it("reads explicit tag", () => {
    expect(explicitMemoryType(entry({ tags: [memoryTypeTag("episodic")] }))).toBe("episodic");
    expect(explicitMemoryType(entry({ tags: [memoryTypeTag("semantic")] }))).toBe("semantic");
    expect(explicitMemoryType(entry({ tags: [] }))).toBeNull();
  });

  it("infers from source/session when untagged", () => {
    expect(inferMemoryType(entry({ source: "conversation", sessionId: "s1" }))).toBe("episodic");
    expect(inferMemoryType(entry({ source: "conversation", sessionId: undefined }))).toBe("semantic");
    expect(inferMemoryType(entry({ source: "user_feedback" }))).toBe("semantic");
    expect(inferMemoryType(entry({ source: "system" }))).toBe("semantic");
  });

  it("explicit tag overrides inference", () => {
    const e = entry({ source: "conversation", sessionId: "s1", tags: [memoryTypeTag("semantic")] });
    expect(inferMemoryType(e)).toBe("semantic");
  });

  it("withMemoryTypeTag is idempotent and swaps type", () => {
    let tags = withMemoryTypeTag(["x"], "episodic");
    expect(tags).toContain("mem:episodic");
    tags = withMemoryTypeTag(tags, "semantic");
    expect(tags).toContain("mem:semantic");
    expect(tags).not.toContain("mem:episodic");
    expect(tags.filter((t) => t === "mem:semantic")).toHaveLength(1);
  });
});

describe("type-filtered retrieval", () => {
  const records = [
    entry({ id: "ep1", source: "conversation", sessionId: "s1" }),
    entry({ id: "se1", source: "system" }),
    entry({ id: "se2", tags: [memoryTypeTag("semantic")] }),
  ];

  it("splits episodic and semantic", () => {
    expect(retrieveEpisodic(records).map((r) => r.id)).toEqual(["ep1"]);
    expect(retrieveSemantic(records).map((r) => r.id).sort()).toEqual(["se1", "se2"]);
  });

  it("can exclude untagged when inferUntagged=false", () => {
    const out = filterByMemoryType(records, "semantic", { inferUntagged: false });
    expect(out.map((r) => r.id)).toEqual(["se2"]);
  });
});

describe("consolidateEpisodicToSemantic", () => {
  it("distills clusters of episodic memories into semantic inputs", async () => {
    const records = [
      entry({ id: "a", source: "conversation", sessionId: "s1", category: "trip", content: "went to Paris", summary: "Paris" }),
      entry({ id: "b", source: "conversation", sessionId: "s1", category: "trip", content: "visited Louvre" }),
      entry({ id: "c", source: "system", category: "trip", content: "semantic note" }),
    ];
    const plan = await consolidateEpisodicToSemantic("agent-1", records);
    expect(plan.semantic).toHaveLength(1);
    expect(plan.semantic[0].agentId).toBe("agent-1");
    expect(plan.semantic[0].category).toBe("trip");
    expect(plan.semantic[0].tags).toContain("mem:semantic");
    expect(plan.semantic[0].tags).toContain("consolidated:episodic");
    expect(plan.semantic[0].content).toContain("Paris");
    expect(plan.sourceIds.sort()).toEqual(["a", "b"]);
  });

  it("respects minCluster", async () => {
    const records = [entry({ id: "a", source: "conversation", sessionId: "s1", category: "x" })];
    const plan = await consolidateEpisodicToSemantic("agent-1", records, { minCluster: 2 });
    expect(plan.semantic).toHaveLength(0);
  });

  it("uses an injected distiller", async () => {
    const records = [
      entry({ id: "a", source: "conversation", sessionId: "s1", category: "x" }),
      entry({ id: "b", source: "conversation", sessionId: "s1", category: "x" }),
    ];
    const plan = await consolidateEpisodicToSemantic("agent-1", records, {
      distill: (cluster) => `distilled-${cluster.length}`,
    });
    expect(plan.semantic[0].content).toBe("distilled-2");
  });
});
