import { describe, it, expect } from "vitest";
import {
  RunController,
  InvalidRunTransitionError,
  isTerminal,
  isValidTransition,
  RunSnapshotSchema,
} from "../../agent/src/approval/pause-resume.js";

function clock(start = 1000) {
  let t = start;
  return () => (t += 1);
}

describe("Pause/Resume Runs (#589)", () => {
  it("starts running with version 0", () => {
    const c = new RunController("run-1", { now: clock() });
    expect(c.status).toBe("running");
    expect(c.getSnapshot().version).toBe(0);
    expect(c.getSnapshot().runId).toBe("run-1");
  });

  it("pauses and resumes, bumping version each time", () => {
    const c = new RunController("run-1", { now: clock() });
    const paused = c.pause({ cursor: 5, metadata: { step: "tool" }, reason: "await approval" });
    expect(paused.status).toBe("paused");
    expect(paused.cursor).toBe(5);
    expect(paused.metadata.step).toBe("tool");
    expect(paused.version).toBe(1);

    const resumed = c.resume({ reason: "approved" });
    expect(resumed.status).toBe("running");
    expect(resumed.version).toBe(2);
    // cursor persists across resume when not overridden
    expect(resumed.cursor).toBe(5);
    // metadata persists
    expect(resumed.metadata.step).toBe("tool");
  });

  it("rejects pausing a non-running run", () => {
    const c = new RunController("run-1");
    c.pause();
    expect(() => c.pause()).toThrow(InvalidRunTransitionError);
  });

  it("rejects resuming a running run", () => {
    const c = new RunController("run-1");
    expect(() => c.resume()).toThrow(InvalidRunTransitionError);
  });

  it("can complete from running but not from paused", () => {
    const c = new RunController("run-1");
    c.pause();
    expect(() => c.complete()).toThrow(InvalidRunTransitionError);
    c.resume();
    const done = c.complete({ reason: "ok" });
    expect(done.status).toBe("completed");
    expect(isTerminal(done.status)).toBe(true);
  });

  it("cannot transition out of a terminal state", () => {
    const c = new RunController("run-1");
    c.complete();
    expect(() => c.pause()).toThrow(InvalidRunTransitionError);
    expect(() => c.cancel()).toThrow(InvalidRunTransitionError);
    expect(c.canTransition("running")).toBe(false);
  });

  it("can cancel from running or paused", () => {
    const a = new RunController("a");
    expect(a.cancel().status).toBe("cancelled");

    const b = new RunController("b");
    b.pause();
    expect(b.cancel().status).toBe("cancelled");
  });

  it("snapshot round-trips through JSON and resumes", () => {
    const c = new RunController("run-1", { now: clock() });
    c.pause({ cursor: "step-3", metadata: { foo: "bar" } });
    const json = JSON.stringify(c.getSnapshot());

    const restored = RunController.fromSnapshot(JSON.parse(json));
    expect(restored.status).toBe("paused");
    expect(restored.canResume()).toBe(true);
    const resumed = restored.resume();
    expect(resumed.status).toBe("running");
    expect(resumed.cursor).toBe("step-3");
    expect(resumed.metadata.foo).toBe("bar");
  });

  it("fromSnapshot rejects invalid snapshots", () => {
    expect(() => RunController.fromSnapshot({ runId: "", status: "bogus" })).toThrow();
  });

  it("validated snapshot defaults metadata to empty object", () => {
    const parsed = RunSnapshotSchema.parse({
      runId: "x",
      status: "running",
      version: 0,
      updatedAt: 1,
    });
    expect(parsed.metadata).toEqual({});
  });

  describe("isValidTransition", () => {
    it("encodes the state machine", () => {
      expect(isValidTransition("running", "paused")).toBe(true);
      expect(isValidTransition("paused", "running")).toBe(true);
      expect(isValidTransition("running", "completed")).toBe(true);
      expect(isValidTransition("paused", "completed")).toBe(false);
      expect(isValidTransition("completed", "running")).toBe(false);
      expect(isValidTransition("paused", "cancelled")).toBe(true);
    });
  });
});
