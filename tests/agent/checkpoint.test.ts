import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHECKPOINT_VERSION,
  CheckpointInterval,
  FileCheckpointStore,
  InMemoryCheckpointStore,
  RunCheckpointSchema,
  deserializeCheckpoint,
  resumeFromCheckpoint,
  safeParseCheckpoint,
  serializeCheckpoint,
  type RunCheckpoint,
} from "../../agent/src/checkpoint/index.js";

function makeCheckpoint(overrides: Partial<RunCheckpoint> = {}): RunCheckpoint {
  return {
    version: CHECKPOINT_VERSION,
    id: "cp-1",
    runId: "run-1",
    sessionId: "sess-1",
    agentId: "agent-1",
    createdAt: 1_700_000_000_000,
    systemPrompt: "You are Karna.",
    model: "claude-sonnet",
    context: [
      { role: "system", content: "You are Karna." },
      { role: "user", content: "Search my notes" },
      {
        role: "assistant",
        content: "Looking that up.",
        toolUses: [{ id: "t1", name: "search", input: { q: "notes" } }],
      },
    ],
    plan: [
      { id: "s1", description: "search notes", status: "done" },
      { id: "s2", description: "summarize", status: "pending" },
    ],
    partialToolResults: [
      {
        id: "t1",
        name: "search",
        input: { q: "notes" },
        output: { hits: 3 },
        isError: false,
        durationMs: 42,
        approved: true,
      },
    ],
    cursor: { iteration: 2, maxIterations: 10, planStep: 1, completed: false },
    usage: { inputTokens: 120, outputTokens: 30 },
    partialResponse: "Looking that up.",
    ...overrides,
  };
}

describe("checkpoint serialization", () => {
  it("round-trips a valid checkpoint", () => {
    const cp = makeCheckpoint();
    const raw = serializeCheckpoint(cp);
    expect(typeof raw).toBe("string");
    const back = deserializeCheckpoint(raw);
    expect(back).toEqual(cp);
  });

  it("rejects invalid checkpoints", () => {
    expect(() => serializeCheckpoint({ ...makeCheckpoint(), version: 2 } as unknown as RunCheckpoint)).toThrow();
    expect(() => deserializeCheckpoint("{not json")).toThrow();
    expect(safeParseCheckpoint({ foo: "bar" })).toBeNull();
    expect(safeParseCheckpoint(makeCheckpoint())).not.toBeNull();
  });
});

describe("resumeFromCheckpoint", () => {
  it("reconstructs in-flight state and folds in missing tool results", () => {
    // The context already has the assistant tool_use but NOT the tool result,
    // so resume should append a synthetic tool message.
    const cp = makeCheckpoint();
    const resumed = resumeFromCheckpoint(cp);

    expect(resumed.runId).toBe("run-1");
    expect(resumed.iteration).toBe(2);
    expect(resumed.maxIterations).toBe(10);
    expect(resumed.planStep).toBe(1);
    expect(resumed.resumable).toBe(true);

    const toolMessages = resumed.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]?.toolCallId).toBe("t1");
    expect(JSON.parse(toolMessages[0]!.content)).toEqual({ hits: 3 });
  });

  it("does not duplicate tool results already present in context", () => {
    const cp = makeCheckpoint({
      context: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          toolUses: [{ id: "t1", name: "search", input: { q: "notes" } }],
        },
        { role: "tool", content: "{\"hits\":3}", toolCallId: "t1", toolName: "search" },
      ],
    });
    const resumed = resumeFromCheckpoint(cp);
    expect(resumed.messages.filter((m) => m.role === "tool")).toHaveLength(1);
  });

  it("marks completed checkpoints as not resumable", () => {
    const cp = makeCheckpoint({
      cursor: { iteration: 3, maxIterations: 10, completed: true },
    });
    expect(resumeFromCheckpoint(cp).resumable).toBe(false);
  });

  it("marks exhausted-iteration checkpoints as not resumable", () => {
    const cp = makeCheckpoint({
      cursor: { iteration: 10, maxIterations: 10, completed: false },
    });
    expect(resumeFromCheckpoint(cp).resumable).toBe(false);
  });
});

describe("CheckpointInterval", () => {
  it("checkpoints on the first iteration then every N", () => {
    const cadence = new CheckpointInterval({ everyIterations: 2 });
    expect(cadence.shouldCheckpoint(1, 0)).toBe(true); // first
    expect(cadence.shouldCheckpoint(2, 0)).toBe(false);
    expect(cadence.shouldCheckpoint(3, 0)).toBe(true); // +2 from 1
    expect(cadence.shouldCheckpoint(4, 0)).toBe(false);
  });

  it("checkpoints on elapsed time even within the iteration window", () => {
    const cadence = new CheckpointInterval({ everyIterations: 100, everyMs: 1000 });
    expect(cadence.shouldCheckpoint(1, 0)).toBe(true);
    expect(cadence.shouldCheckpoint(2, 500)).toBe(false);
    expect(cadence.shouldCheckpoint(3, 1200)).toBe(true); // elapsed >= 1000ms
  });

  it("resets state", () => {
    const cadence = new CheckpointInterval();
    expect(cadence.shouldCheckpoint(5, 0)).toBe(true);
    cadence.reset();
    expect(cadence.shouldCheckpoint(9, 0)).toBe(true);
  });

  it("validates options", () => {
    expect(() => new CheckpointInterval({ everyIterations: 0 })).toThrow();
    expect(() => new CheckpointInterval({ everyMs: -5 })).toThrow();
  });
});

describe("InMemoryCheckpointStore", () => {
  it("saves, loads, lists and deletes", async () => {
    const store = new InMemoryCheckpointStore();
    await store.save(makeCheckpoint());
    expect(store.size).toBe(1);

    const loaded = await store.load("run-1");
    expect(loaded).not.toBeNull();
    expect(loaded?.runId).toBe("run-1");

    expect(await store.list()).toEqual(["run-1"]);
    expect(await store.load("missing")).toBeNull();
    expect(await store.delete("run-1")).toBe(true);
    expect(await store.delete("run-1")).toBe(false);
    expect(store.size).toBe(0);
  });

  it("returns clones that do not mutate stored state", async () => {
    const store = new InMemoryCheckpointStore();
    await store.save(makeCheckpoint());
    const loaded = await store.load("run-1");
    loaded!.partialResponse = "MUTATED";
    const reloaded = await store.load("run-1");
    expect(reloaded?.partialResponse).toBe("Looking that up.");
  });

  it("overwrites the checkpoint per run", async () => {
    const store = new InMemoryCheckpointStore();
    await store.save(makeCheckpoint({ partialResponse: "v1" }));
    await store.save(makeCheckpoint({ partialResponse: "v2" }));
    expect(store.size).toBe(1);
    expect((await store.load("run-1"))?.partialResponse).toBe("v2");
  });
});

describe("FileCheckpointStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "karna-checkpoints-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists and reloads the latest checkpoint (append-only)", async () => {
    const store = new FileCheckpointStore({ dir });
    await store.save(makeCheckpoint({ partialResponse: "first" }));
    await store.save(makeCheckpoint({ partialResponse: "second" }));

    const loaded = await store.load("run-1");
    expect(loaded?.partialResponse).toBe("second");
    expect(await store.list()).toEqual(["run-1"]);
  });

  it("recovers the previous checkpoint when the last line is corrupt", async () => {
    const store = new FileCheckpointStore({ dir });
    await store.save(makeCheckpoint({ partialResponse: "good" }));
    // Simulate a partially-written final line (crash mid-write).
    const file = join(dir, "run-1.jsonl");
    await writeFile(file, (await readFileSafe(file)) + "{partial broken line\n", "utf-8");

    const loaded = await store.load("run-1");
    expect(loaded?.partialResponse).toBe("good");
  });

  it("returns null for unknown runs and deletes files", async () => {
    const store = new FileCheckpointStore({ dir });
    expect(await store.load("nope")).toBeNull();
    expect(await store.delete("nope")).toBe(false);

    await store.save(makeCheckpoint());
    expect(await store.delete("run-1")).toBe(true);
    expect(await store.load("run-1")).toBeNull();
    const files = await readdir(dir);
    expect(files).toHaveLength(0);
  });

  it("sanitizes run ids with unsafe characters", async () => {
    const store = new FileCheckpointStore({ dir });
    await store.save(makeCheckpoint({ runId: "run/../weird id" }));
    const loaded = await store.load("run/../weird id");
    expect(loaded?.runId).toBe("run/../weird id");
    const files = await readdir(dir);
    expect(files.every((f) => !f.includes("/"))).toBe(true);
  });

  it("validates persisted checkpoints against the schema", async () => {
    const store = new FileCheckpointStore({ dir });
    const cp = makeCheckpoint();
    await store.save(cp);
    const loaded = await store.load("run-1");
    expect(() => RunCheckpointSchema.parse(loaded)).not.toThrow();
  });
});

async function readFileSafe(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf-8");
}
