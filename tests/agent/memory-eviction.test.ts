// ─── Memory Eviction Tests ───────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  selectExpired,
  selectLru,
  selectByImportance,
  selectForEviction,
  retainAfterEviction,
} from "../../agent/src/memory/eviction.js";
import type { MemoryEntry, MemoryPriority } from "@karna/shared/types/memory.js";

const NOW = 1_000_000;

function makeEntry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  return {
    content: "c",
    source: "conversation",
    priority: "normal" as MemoryPriority,
    tags: [],
    relatedMessageIds: [],
    relatedMemoryIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    accessedAt: NOW,
    accessCount: 0,
    decayFactor: 1,
    ...overrides,
  };
}

function ids(entries: MemoryEntry[]): string[] {
  return entries.map((e) => e.id).sort();
}

describe("eviction.selectExpired (ttl)", () => {
  it("evicts entries whose expiresAt has elapsed", () => {
    const records = [
      makeEntry({ id: "a", expiresAt: NOW - 1 }),
      makeEntry({ id: "b", expiresAt: NOW + 1000 }),
      makeEntry({ id: "c" }), // no expiry
    ];
    expect(ids(selectExpired(records, { now: NOW }))).toEqual(["a"]);
  });

  it("evicts entries older than maxAgeMs", () => {
    const records = [
      makeEntry({ id: "old", createdAt: NOW - 5000 }),
      makeEntry({ id: "new", createdAt: NOW - 100 }),
    ];
    expect(ids(selectExpired(records, { now: NOW, maxAgeMs: 1000 }))).toEqual(["old"]);
  });

  it("never evicts protected (critical) priority", () => {
    const records = [makeEntry({ id: "a", priority: "critical", expiresAt: NOW - 1 })];
    expect(selectExpired(records, { now: NOW })).toEqual([]);
  });
});

describe("eviction.selectLru", () => {
  it("evicts the least-recently-accessed surplus", () => {
    const records = [
      makeEntry({ id: "a", accessedAt: NOW - 300 }),
      makeEntry({ id: "b", accessedAt: NOW - 200 }),
      makeEntry({ id: "c", accessedAt: NOW - 100 }),
    ];
    // capacity 2 => evict 1 oldest
    expect(ids(selectLru(records, { maxEntries: 2 }))).toEqual(["a"]);
  });

  it("returns nothing when under capacity", () => {
    const records = [makeEntry({ id: "a" })];
    expect(selectLru(records, { maxEntries: 5 })).toEqual([]);
  });

  it("does not evict protected entries to reach capacity", () => {
    const records = [
      makeEntry({ id: "a", priority: "critical", accessedAt: NOW - 999 }),
      makeEntry({ id: "b", accessedAt: NOW - 1 }),
    ];
    expect(ids(selectLru(records, { maxEntries: 1 }))).toEqual(["b"]);
  });
});

describe("eviction.selectByImportance", () => {
  it("evicts the lowest-importance surplus first", () => {
    const records = [
      makeEntry({ id: "low", priority: "low", accessCount: 0 }),
      makeEntry({ id: "high", priority: "high", accessCount: 10 }),
      makeEntry({ id: "norm", priority: "normal", accessCount: 1 }),
    ];
    expect(ids(selectByImportance(records, { maxEntries: 2 }))).toEqual(["low"]);
  });
});

describe("eviction.selectForEviction dispatcher", () => {
  it("ttl policy ignores capacity", () => {
    const records = [
      makeEntry({ id: "a", expiresAt: NOW - 1 }),
      makeEntry({ id: "b" }),
      makeEntry({ id: "c" }),
    ];
    expect(ids(selectForEviction(records, { policy: "ttl", now: NOW, maxEntries: 1 }))).toEqual([
      "a",
    ]);
  });

  it("capacity policies also honor explicit expiry", () => {
    const records = [
      makeEntry({ id: "expired", expiresAt: NOW - 1, accessedAt: NOW }),
      makeEntry({ id: "b", accessedAt: NOW - 10 }),
      makeEntry({ id: "c", accessedAt: NOW - 5 }),
    ];
    // policy lru, capacity 2: expired always out + 1 lru of the rest (b oldest).
    // But expired is removed from the "live" set first, leaving b,c (2) == cap, so no extra.
    expect(ids(selectForEviction(records, { policy: "lru", now: NOW, maxEntries: 2 }))).toEqual([
      "expired",
    ]);
  });

  it("retainAfterEviction returns the survivors", () => {
    const records = [
      makeEntry({ id: "a", accessedAt: NOW - 100 }),
      makeEntry({ id: "b", accessedAt: NOW - 1 }),
    ];
    const survivors = retainAfterEviction(records, { policy: "lru", maxEntries: 1 });
    expect(ids(survivors)).toEqual(["b"]);
  });

  it("does not mutate the input array", () => {
    const records = [makeEntry({ id: "a", expiresAt: NOW - 1 })];
    const copy = [...records];
    selectForEviction(records, { policy: "ttl", now: NOW });
    expect(records).toEqual(copy);
  });
});
