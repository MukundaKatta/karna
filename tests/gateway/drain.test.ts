import { describe, expect, it, vi } from "vitest";
import {
  AcceptGate,
  DrainCoordinator,
  drainInFlight,
  type InFlightRun,
} from "../../gateway/src/shutdown/drain.js";

function deferred(): { run: InFlightRun; resolve: () => void; reject: (e: unknown) => void } {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { run: { id: Math.random().toString(36).slice(2), done }, resolve, reject };
}

describe("AcceptGate", () => {
  it("starts open and closes one-way", () => {
    const gate = new AcceptGate();
    expect(gate.isAccepting()).toBe(true);
    gate.close();
    expect(gate.isAccepting()).toBe(false);
    gate.close();
    expect(gate.isAccepting()).toBe(false);
  });
});

describe("DrainCoordinator", () => {
  it("closes the accept gate and checkpoints every in-flight run", async () => {
    const a = deferred();
    const b = deferred();
    const checkpointed: string[] = [];

    const coord = new DrainCoordinator({
      inFlight: () => [a.run, b.run],
      checkpoint: (run) => {
        checkpointed.push(run.id);
      },
    });

    expect(coord.isAccepting()).toBe(true);
    const p = coord.drain("SIGTERM", { graceMs: 1000 });
    expect(coord.isAccepting()).toBe(false);

    // Let runs complete so the drain resolves naturally.
    a.resolve();
    b.resolve();
    const result = await p;

    expect(checkpointed.sort()).toEqual([a.run.id, b.run.id].sort());
    expect(result.drained).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.completed).toBe(2);
    expect(result.abandoned).toBe(0);
    expect(result.checkpoints.every((c) => c.ok)).toBe(true);
    expect(result.runs.every((r) => r.disposition === "completed" && r.checkpointed)).toBe(true);
  });

  it("abandons runs that exceed the hard deadline", async () => {
    vi.useFakeTimers();
    const stuck = deferred(); // never resolves
    const checkpointed: string[] = [];

    const result = drainInFlight(
      "SIGTERM",
      {
        inFlight: () => [stuck.run],
        checkpoint: (run) => {
          checkpointed.push(run.id);
        },
      },
      { graceMs: 1000, hardDeadlineExtraMs: 500 },
    );

    // Advance past grace + extra = 1500ms.
    await vi.advanceTimersByTimeAsync(1500);
    const r = await result;

    expect(checkpointed).toEqual([stuck.run.id]);
    expect(r.timedOut).toBe(true);
    expect(r.drained).toBe(false);
    expect(r.abandoned).toBe(1);
    expect(r.completed).toBe(0);
    expect(r.runs[0]?.disposition).toBe("abandoned");
    expect(r.runs[0]?.checkpointed).toBe(true);
    vi.useRealTimers();
  });

  it("resolves immediately when there is no in-flight work", async () => {
    const onStart = vi.fn();
    const r = await drainInFlight(
      "SIGINT",
      { inFlight: () => [], checkpoint: () => {}, onDrainStart: onStart },
      { graceMs: 5000 },
    );
    expect(r.totalRuns).toBe(0);
    expect(r.drained).toBe(true);
    expect(onStart).toHaveBeenCalledWith("SIGINT");
  });

  it("captures checkpoint errors without aborting the drain", async () => {
    const a = deferred();
    const coord = new DrainCoordinator({
      inFlight: () => [a.run],
      checkpoint: () => {
        throw new Error("disk full");
      },
    });
    const p = coord.drain("SIGTERM", { graceMs: 1000 });
    a.resolve();
    const r = await p;
    expect(r.checkpoints[0]?.ok).toBe(false);
    expect(r.checkpoints[0]?.error).toContain("disk full");
    expect(r.completed).toBe(1);
    expect(r.runs[0]?.checkpointed).toBe(false);
  });

  it("counts a rejecting run as completed (it left the in-flight set)", async () => {
    const a = deferred();
    const coord = new DrainCoordinator({
      inFlight: () => [a.run],
      checkpoint: () => {},
    });
    const p = coord.drain("SIGTERM", { graceMs: 1000 });
    a.reject(new Error("boom"));
    const r = await p;
    expect(r.completed).toBe(1);
    expect(r.drained).toBe(true);
  });

  it("is idempotent: repeated drain() returns the same promise", async () => {
    const a = deferred();
    const coord = new DrainCoordinator({ inFlight: () => [a.run], checkpoint: () => {} });
    const p1 = coord.drain("SIGTERM", { graceMs: 1000 });
    const p2 = coord.drain("SIGTERM", { graceMs: 1000 });
    expect(p1).toBe(p2);
    a.resolve();
    await p1;
  });
});
