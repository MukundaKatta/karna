// ─── Memory Namespace Tests ──────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  makeNamespace,
  parseNamespace,
  namespaceTag,
  namespaceFromEntry,
  entryMatchesNamespace,
  filterByNamespace,
  isGlobalNamespace,
  GLOBAL_NAMESPACE,
} from "../../agent/src/memory/namespace.js";
import type { MemoryEntry, MemoryPriority } from "@karna/shared/types/memory.js";

function makeEntry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  const now = Date.now();
  return {
    content: "c",
    source: "conversation",
    priority: "normal" as MemoryPriority,
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

describe("namespace.makeNamespace / parseNamespace", () => {
  it("builds and parses a full namespace", () => {
    const key = makeNamespace("u1", "c1");
    expect(key).toBe("u:u1::c:c1");
    expect(parseNamespace(key)).toEqual({ userId: "u1", channelId: "c1" });
  });

  it("uses wildcards for missing segments", () => {
    expect(makeNamespace("u1")).toBe("u:u1::c:*");
    expect(parseNamespace("u:u1::c:*")).toEqual({ userId: "u1", channelId: undefined });
  });

  it("sanitizes unsafe characters", () => {
    expect(makeNamespace("a/b:c", "x y")).toBe("u:a_b_c::c:x_y");
  });

  it("global namespace round-trips", () => {
    expect(isGlobalNamespace(GLOBAL_NAMESPACE)).toBe(true);
    expect(parseNamespace(GLOBAL_NAMESPACE)).toEqual({ userId: undefined, channelId: undefined });
  });

  it("returns null for invalid keys", () => {
    expect(parseNamespace("garbage")).toBeNull();
    expect(parseNamespace("x:1::y:2")).toBeNull();
  });
});

describe("namespace tagging", () => {
  it("builds a tag and extracts it from an entry", () => {
    const tag = namespaceTag("u1", "c1");
    expect(tag).toBe("ns:u:u1::c:c1");
    const entry = makeEntry({ id: "a", tags: ["misc", tag] });
    expect(namespaceFromEntry(entry)).toBe("u:u1::c:c1");
  });

  it("returns null when no namespace tag present", () => {
    expect(namespaceFromEntry(makeEntry({ id: "a", tags: ["misc"] }))).toBeNull();
  });
});

describe("namespace.entryMatchesNamespace", () => {
  it("matches by stamped tag", () => {
    const entry = makeEntry({ id: "a", tags: [namespaceTag("u1", "c1")] });
    expect(entryMatchesNamespace(entry, makeNamespace("u1", "c1"))).toBe(true);
    expect(entryMatchesNamespace(entry, makeNamespace("u2", "c1"))).toBe(false);
  });

  it("wildcard query matches any channel", () => {
    const entry = makeEntry({ id: "a", tags: [namespaceTag("u1", "c1")] });
    expect(entryMatchesNamespace(entry, makeNamespace("u1"))).toBe(true);
  });

  it("matches by structured userId field", () => {
    const entry = makeEntry({ id: "a", userId: "u1" });
    expect(entryMatchesNamespace(entry, makeNamespace("u1"))).toBe(true);
    expect(entryMatchesNamespace(entry, makeNamespace("u2"))).toBe(false);
  });

  it("un-namespaced entry only matches the global query", () => {
    const entry = makeEntry({ id: "a" });
    expect(entryMatchesNamespace(entry, GLOBAL_NAMESPACE)).toBe(true);
    expect(entryMatchesNamespace(entry, makeNamespace("u1"))).toBe(false);
  });
});

describe("namespace.filterByNamespace", () => {
  const records = [
    makeEntry({ id: "u1c1", tags: [namespaceTag("u1", "c1")] }),
    makeEntry({ id: "u2c1", tags: [namespaceTag("u2", "c1")] }),
    makeEntry({ id: "global" }),
  ];

  it("includes matching + global entries by default", () => {
    const out = filterByNamespace(records, makeNamespace("u1", "c1")).map((e) => e.id).sort();
    expect(out).toEqual(["global", "u1c1"]);
  });

  it("can exclude global entries", () => {
    const out = filterByNamespace(records, makeNamespace("u1", "c1"), {
      includeGlobal: false,
    }).map((e) => e.id);
    expect(out).toEqual(["u1c1"]);
  });

  it("global query returns all records unchanged", () => {
    expect(filterByNamespace(records, GLOBAL_NAMESPACE)).toHaveLength(3);
  });

  it("does not mutate input", () => {
    const copy = [...records];
    filterByNamespace(records, makeNamespace("u1", "c1"));
    expect(records).toEqual(copy);
  });
});
