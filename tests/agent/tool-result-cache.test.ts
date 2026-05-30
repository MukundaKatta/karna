// ─── Tool Result Cache Tests (Issue #548) ────────────────────────────────────

import { describe, it, expect } from "vitest";
import { ToolResultCache, stableStringify } from "../../agent/src/tools/result-cache.js";

describe("ToolResultCache", () => {
  it("is disabled by default (no behavior change)", () => {
    const cache = new ToolResultCache();
    expect(cache.isEnabled("t")).toBe(false);
    cache.set("t", { a: 1 }, "value");
    expect(cache.get("t", { a: 1 })).toEqual({ hit: false });
  });

  it("caches and returns hits when enabled", () => {
    const cache = new ToolResultCache({ t: { enabled: true, ttlMs: 1000 } });
    expect(cache.get("t", { a: 1 }).hit).toBe(false); // miss
    cache.set("t", { a: 1 }, { result: 42 });
    const got = cache.get("t", { a: 1 });
    expect(got).toEqual({ hit: true, value: { result: 42 } });
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(1);
  });

  it("treats differently-ordered args as the same key", () => {
    const cache = new ToolResultCache({ t: { enabled: true, ttlMs: 1000 } });
    cache.set("t", { a: 1, b: 2 }, "v");
    expect(cache.get("t", { b: 2, a: 1 })).toEqual({ hit: true, value: "v" });
  });

  it("expires entries after TTL using a controllable clock", () => {
    let now = 0;
    const cache = new ToolResultCache(
      { t: { enabled: true, ttlMs: 100 } },
      { now: () => now }
    );
    cache.set("t", {}, "v");
    now = 50;
    expect(cache.get("t", {}).hit).toBe(true);
    now = 150;
    expect(cache.get("t", {}).hit).toBe(false);
  });

  it("invalidates per-tool entries", () => {
    const cache = new ToolResultCache({
      a: { enabled: true, ttlMs: 1000 },
      b: { enabled: true, ttlMs: 1000 },
    });
    cache.set("a", {}, 1);
    cache.set("b", {}, 2);
    expect(cache.invalidate("a")).toBe(1);
    expect(cache.get("a", {}).hit).toBe(false);
    expect(cache.get("b", {}).hit).toBe(true);
  });

  it("evicts when over max entries", () => {
    const cache = new ToolResultCache(
      { t: { enabled: true, ttlMs: 100000 } },
      { maxEntries: 2 }
    );
    cache.set("t", { i: 1 }, "a");
    cache.set("t", { i: 2 }, "b");
    cache.set("t", { i: 3 }, "c");
    expect(cache.stats().size).toBe(2);
    expect(cache.stats().evictions).toBe(1);
  });
});

describe("stableStringify", () => {
  it("produces order-independent output for nested objects", () => {
    const a = stableStringify({ x: { b: 2, a: 1 }, y: [3, { d: 4, c: 5 }] });
    const b = stableStringify({ y: [3, { c: 5, d: 4 }], x: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });
});
