// ─── Memory Export/Import Tests (Issue #539) ─────────────────────────────────

import { describe, it, expect } from "vitest";
import type { MemoryEntry } from "@karna/shared/types/memory.js";
import {
  exportMemories,
  serializeExport,
  importMemories,
  deserializeImport,
  envelopeToSaveInputs,
  applyImport,
  MEMORY_EXPORT_VERSION,
  MemoryExportEnvelopeSchema,
} from "../../agent/src/memory/portability.js";
import { MemoryStore, InMemoryBackend } from "../../agent/src/memory/store.js";

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = 1_700_000_000_000;
  return {
    id: overrides.id ?? "m1",
    content: "User prefers dark mode",
    source: "conversation",
    priority: "normal",
    tags: ["preference"],
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

describe("exportMemories", () => {
  it("produces a versioned, schema-valid envelope", () => {
    const env = exportMemories("agent-1", [entry()], { exportedAt: 123, userId: "u1" });
    expect(env.version).toBe(MEMORY_EXPORT_VERSION);
    expect(env.kind).toBe("karna.memory.export");
    expect(env.agentId).toBe("agent-1");
    expect(env.userId).toBe("u1");
    expect(env.exportedAt).toBe(123);
    expect(env.entries).toHaveLength(1);
    expect(MemoryExportEnvelopeSchema.safeParse(env).success).toBe(true);
  });
});

describe("round-trip", () => {
  it("serialize -> deserialize yields equal entries", () => {
    const env = exportMemories("agent-1", [entry({ id: "a" }), entry({ id: "b", content: "second" })], {
      exportedAt: 999,
    });
    const json = serializeExport(env, true);
    const result = deserializeImport(json);
    expect(result.ok).toBe(true);
    expect(result.envelope?.entries).toHaveLength(2);
    expect(result.envelope).toEqual(env);
  });

  it("importMemories validates and reports errors", () => {
    const bad = importMemories({ version: 2, kind: "karna.memory.export", agentId: "a", exportedAt: 1, entries: [] });
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);

    const notJson = deserializeImport("{not json");
    expect(notJson.ok).toBe(false);
    expect(notJson.errors[0]).toContain("Invalid JSON");
  });
});

describe("envelopeToSaveInputs", () => {
  it("drops lifecycle fields and carries content/metadata", () => {
    const env = exportMemories("agent-1", [entry({ id: "x", embedding: [0.1, 0.2], category: "ui" })], {
      exportedAt: 1,
      userId: "u9",
    });
    const inputs = envelopeToSaveInputs(env);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].agentId).toBe("agent-1");
    expect(inputs[0].content).toBe("User prefers dark mode");
    expect(inputs[0].embedding).toEqual([0.1, 0.2]);
    expect(inputs[0].category).toBe("ui");
    // userId falls back to the envelope userId when entry lacks one.
    expect(inputs[0].userId).toBe("u9");
    // No id / createdAt leaked into the save input.
    expect((inputs[0] as Record<string, unknown>).id).toBeUndefined();
    expect((inputs[0] as Record<string, unknown>).createdAt).toBeUndefined();
  });
});

describe("applyImport into a store", () => {
  it("re-persists entries into a fresh backend", async () => {
    const store = new MemoryStore(new InMemoryBackend());
    const env = exportMemories(
      "agent-1",
      [entry({ id: "a", content: "fact one" }), entry({ id: "b", content: "fact two" })],
      { exportedAt: 1 },
    );
    const res = await applyImport(env, store);
    expect(res.saved).toBe(2);
    expect(res.failed).toBe(0);

    const persisted = await store.listByAgent("agent-1");
    expect(persisted).toHaveLength(2);
    // Fresh ids assigned by the backend, not the original "a"/"b".
    expect(persisted.every((m) => m.id.startsWith("mem_"))).toBe(true);
    expect(persisted.map((m) => m.content).sort()).toEqual(["fact one", "fact two"]);
  });
});
