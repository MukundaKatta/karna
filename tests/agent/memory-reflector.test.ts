// ─── Reflector Agent Tests (Issue #534) ──────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  Reflector,
  reflectionToSaveInput,
  type ReflectionSummarizer,
} from "../../agent/src/memory/reflector.js";
import type { Observation } from "../../agent/src/memory/observer.js";

function obs(overrides: Partial<Observation> = {}): Observation {
  return {
    content: "User likes tea",
    kind: "preference",
    importance: 0.5,
    tags: [],
    ...overrides,
  };
}

describe("Reflector triggers", () => {
  it("reflects when count threshold reached", async () => {
    const r = new Reflector({ threshold: 3 });
    r.add(obs({ content: "a" }));
    r.add(obs({ content: "b" }));
    expect(r.shouldReflect()).toBe(false);
    r.add(obs({ content: "c" }));
    expect(r.shouldReflect()).toBe(true);

    const reflections = await r.tick();
    expect(reflections).toHaveLength(1);
    expect(reflections[0].sourceCount).toBe(3);
    expect(r.pending).toBe(0);
  });

  it("reflects on elapsed interval via injected clock", async () => {
    let t = 1000;
    const r = new Reflector({ threshold: 100, intervalMs: 500, now: () => t });
    r.add(obs());
    expect(r.shouldReflect()).toBe(false);
    t += 600;
    expect(r.shouldReflect()).toBe(true);
    const reflections = await r.reflect();
    expect(reflections).toHaveLength(1);
  });

  it("tick is a no-op when not triggered", async () => {
    const r = new Reflector({ threshold: 5 });
    r.add(obs());
    expect(await r.tick()).toEqual([]);
    expect(r.pending).toBe(1);
  });
});

describe("Reflector consolidation", () => {
  it("groups by kind and stamps semantic memory-type tag", async () => {
    const r = new Reflector({ threshold: 4 });
    r.addMany([
      obs({ kind: "preference", content: "likes tea", tags: ["drink"] }),
      obs({ kind: "preference", content: "likes coffee", tags: ["drink"] }),
      obs({ kind: "fact", content: "lives in NYC", tags: ["loc"] }),
      obs({ kind: "fact", content: "works remote" }),
    ]);
    const reflections = await r.reflect();
    expect(reflections).toHaveLength(2);
    for (const ref of reflections) {
      expect(ref.tags).toContain("mem:semantic");
    }
    const pref = reflections.find((x) => x.category === "preference");
    expect(pref?.content).toContain("likes tea");
    expect(pref?.content).toContain("likes coffee");
  });

  it("deduplicates identical observation content within a group", async () => {
    const r = new Reflector({ threshold: 3 });
    r.addMany([
      obs({ kind: "fact", content: "same fact" }),
      obs({ kind: "fact", content: "same fact" }),
      obs({ kind: "fact", content: "other" }),
    ]);
    const [ref] = await r.reflect();
    // Default summarizer joins unique contents.
    expect(ref.content).toBe("same fact; other");
  });

  it("uses an injected summarizer", async () => {
    const summarizer: ReflectionSummarizer = (contents) => `[${contents.length}]`;
    const r = new Reflector({ threshold: 2, summarizer });
    r.addMany([obs({ kind: "fact", content: "x" }), obs({ kind: "fact", content: "y" })]);
    const [ref] = await r.reflect();
    expect(ref.content).toBe("[2]");
  });

  it("carries highest importance into the reflection", async () => {
    const r = new Reflector({ threshold: 2 });
    r.addMany([
      obs({ kind: "fact", content: "a", importance: 0.3 }),
      obs({ kind: "fact", content: "b", importance: 0.95 }),
    ]);
    const [ref] = await r.reflect();
    expect(ref.importance).toBeCloseTo(0.95, 6);
  });
});

describe("reflectionToSaveInput", () => {
  it("maps importance to priority and carries fields", async () => {
    const r = new Reflector({ threshold: 1 });
    r.add(obs({ kind: "fact", content: "z", importance: 0.95, sessionId: "s1" }));
    const [ref] = await r.reflect();
    const input = reflectionToSaveInput("agent-1", ref);
    expect(input.agentId).toBe("agent-1");
    expect(input.priority).toBe("high");
    expect(input.source).toBe("system");
    expect(input.category).toBe("fact");
    expect(input.sessionId).toBe("s1");
    expect(input.tags).toContain("mem:semantic");
  });
});
