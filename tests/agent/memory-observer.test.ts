// ─── Observer Agent Tests (Issue #533) ───────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  Observer,
  ObservationSchema,
  type TranscriptTurn,
  type Observation,
} from "../../agent/src/memory/observer.js";

function turn(content: string, overrides: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return { role: "user", content, ...overrides };
}

describe("ObservationSchema", () => {
  it("applies defaults and rejects malformed", () => {
    const ok = ObservationSchema.parse({ content: "User likes tea" });
    expect(ok.kind).toBe("observation");
    expect(ok.importance).toBe(0.5);
    expect(ObservationSchema.safeParse({ content: "" }).success).toBe(false);
    expect(ObservationSchema.safeParse({ content: "x", importance: 2 }).success).toBe(false);
  });
});

describe("Observer batching", () => {
  it("triggers extraction at batch size and produces validated observations", async () => {
    const seen: TranscriptTurn[][] = [];
    const obs = new Observer(
      (turns) => {
        seen.push(turns);
        return turns.map((t) => ({ content: `obs:${t.content}`, importance: 0.6 }));
      },
      { batchSize: 2 },
    );

    expect(await obs.observe(turn("a"))).toEqual([]);
    expect(obs.pending).toBe(1);

    const produced = await obs.observe(turn("b"));
    expect(produced).toHaveLength(2);
    expect(produced[0].content).toBe("obs:a");
    expect(seen).toHaveLength(1);
    expect(obs.pending).toBe(0);
  });

  it("flush extracts remaining sub-batch turns", async () => {
    const obs = new Observer((turns) => turns.map((t) => ({ content: t.content })), {
      batchSize: 5,
    });
    await obs.observe(turn("x"));
    await obs.observe(turn("y"));
    const produced = await obs.flush();
    expect(produced.map((o) => o.content)).toEqual(["x", "y"]);
    expect(obs.pending).toBe(0);
  });

  it("skips empty and ignored-role turns", async () => {
    const obs = new Observer((turns) => turns.map((t) => ({ content: t.content })), {
      batchSize: 1,
      ignoreRoles: ["system"],
    });
    expect(await obs.observe(turn("   "))).toEqual([]);
    expect(await obs.observe(turn("sys", { role: "system" }))).toEqual([]);
    expect(obs.pending).toBe(0);
  });

  it("inherits session/user context from the batch when extractor omits it", async () => {
    const obs = new Observer((turns) => turns.map((t) => ({ content: t.content })), {
      batchSize: 1,
    });
    const produced = await obs.observe(
      turn("hello", { sessionId: "s1", userId: "u1" }),
    );
    expect(produced[0].sessionId).toBe("s1");
    expect(produced[0].userId).toBe("u1");
  });

  it("drops malformed observations but keeps valid ones", async () => {
    const obs = new Observer(
      () => [{ content: "good" }, { content: "" }, { nope: true }],
      { batchSize: 1 },
    );
    const produced = await obs.observe(turn("t"));
    expect(produced).toHaveLength(1);
    expect(produced[0].content).toBe("good");
  });

  it("survives extractor throwing", async () => {
    const obs = new Observer(
      () => {
        throw new Error("boom");
      },
      { batchSize: 1 },
    );
    await expect(obs.observe(turn("t"))).resolves.toEqual([]);
  });

  it("delivers to an injected sink and records observations", async () => {
    const delivered: Observation[] = [];
    const obs = new Observer((turns) => turns.map((t) => ({ content: t.content })), {
      batchSize: 1,
      sink: (o) => {
        delivered.push(...o);
      },
    });
    await obs.observe(turn("a"));
    await obs.observe(turn("b"));
    expect(delivered.map((o) => o.content)).toEqual(["a", "b"]);
    expect(obs.getObservations()).toHaveLength(2);
  });

  it("drains in full batches, leaving the remainder buffered", async () => {
    const obs = new Observer(() => [], { batchSize: 4 });
    for (let i = 0; i < 6; i++) await obs.observe(turn(`t${i}`));
    // Reaching batchSize=4 drains (extractor returns nothing), then 2 remain.
    expect(obs.pending).toBe(2);
  });

  it("drops oldest turns when the cap is exceeded", async () => {
    // Batch size larger than the turn count means observe() never drains, so
    // the buffer grows until the cap trims the oldest turns.
    const obs = new Observer(() => [], { batchSize: 10, maxQueued: 3 });
    for (let i = 0; i < 6; i++) await obs.observe(turn(`t${i}`));
    expect(obs.pending).toBe(3);
    expect(obs.droppedCount).toBe(3);
  });
});
