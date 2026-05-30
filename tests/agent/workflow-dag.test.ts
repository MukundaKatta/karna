import { describe, it, expect, vi } from "vitest";
import {
  runDag,
  validateDag,
  DagCycleError,
  DagDefinitionError,
  type DagStep,
} from "../../agent/src/workflows/dag.js";

// A sleep that does not actually wait, for fast retry/backoff tests.
const noSleep = async (): Promise<void> => {};

describe("workflow DAG executor", () => {
  describe("validateDag", () => {
    it("topologically orders dependencies before dependents", () => {
      const { order } = validateDag([
        { id: "c", dependsOn: ["b"], run: () => null },
        { id: "b", dependsOn: ["a"], run: () => null },
        { id: "a", run: () => null },
      ]);
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    });

    it("throws DagDefinitionError on duplicate ids", () => {
      expect(() =>
        validateDag([
          { id: "a", run: () => null },
          { id: "a", run: () => null },
        ])
      ).toThrow(DagDefinitionError);
    });

    it("throws DagDefinitionError on unknown dependency", () => {
      expect(() =>
        validateDag([{ id: "a", dependsOn: ["ghost"], run: () => null }])
      ).toThrow(DagDefinitionError);
    });

    it("detects self-dependency as a cycle", () => {
      expect(() =>
        validateDag([{ id: "a", dependsOn: ["a"], run: () => null }])
      ).toThrow(DagCycleError);
    });

    it("detects multi-node cycles and reports the path", () => {
      let caught: DagCycleError | undefined;
      try {
        validateDag([
          { id: "a", dependsOn: ["c"], run: () => null },
          { id: "b", dependsOn: ["a"], run: () => null },
          { id: "c", dependsOn: ["b"], run: () => null },
        ]);
      } catch (err) {
        caught = err as DagCycleError;
      }
      expect(caught).toBeInstanceOf(DagCycleError);
      // Cycle path includes the repeated node closing the loop.
      expect(caught!.cycle.length).toBeGreaterThanOrEqual(2);
      expect(caught!.cycle[0]).toBe(caught!.cycle[caught!.cycle.length - 1]);
    });
  });

  describe("dependency execution", () => {
    it("runs steps respecting dependencies and exposes upstream results", async () => {
      const calls: string[] = [];
      const steps: DagStep[] = [
        {
          id: "a",
          run: () => {
            calls.push("a");
            return 1;
          },
        },
        {
          id: "b",
          dependsOn: ["a"],
          run: (ctx) => {
            calls.push("b");
            return (ctx.results.a as number) + 1;
          },
        },
        {
          id: "c",
          dependsOn: ["a", "b"],
          run: (ctx) => {
            calls.push("c");
            return (ctx.results.a as number) + (ctx.results.b as number);
          },
        },
      ];

      const run = await runDag(steps, { sleep: noSleep });
      expect(run.status).toBe("completed");
      expect(run.outputs).toEqual({ a: 1, b: 2, c: 3 });
      // a before b before c
      expect(calls.indexOf("a")).toBeLessThan(calls.indexOf("b"));
      expect(calls.indexOf("b")).toBeLessThan(calls.indexOf("c"));
    });

    it("runs a diamond and reduces correctly", async () => {
      const steps: DagStep[] = [
        { id: "root", run: () => 10 },
        { id: "left", dependsOn: ["root"], run: (c) => (c.results.root as number) * 2 },
        { id: "right", dependsOn: ["root"], run: (c) => (c.results.root as number) + 5 },
        {
          id: "join",
          dependsOn: ["left", "right"],
          run: (c) => (c.results.left as number) + (c.results.right as number),
        },
      ];
      const run = await runDag(steps, { sleep: noSleep });
      expect(run.status).toBe("completed");
      expect(run.outputs.join).toBe(20 + 15);
    });
  });

  describe("retries and backoff", () => {
    it("retries a flaky step until it succeeds", async () => {
      let attempts = 0;
      const steps: DagStep[] = [
        {
          id: "flaky",
          retry: { maxRetries: 3, backoffMs: 5, backoffFactor: 2 },
          run: () => {
            attempts++;
            if (attempts < 3) throw new Error("transient");
            return "ok";
          },
        },
      ];
      const run = await runDag(steps, { sleep: noSleep });
      expect(run.status).toBe("completed");
      expect(run.outputs.flaky).toBe("ok");
      const step = run.steps.find((s) => s.stepId === "flaky")!;
      expect(step.attempts).toBe(3);
    });

    it("applies exponential backoff delays between attempts", async () => {
      const delays: number[] = [];
      const sleep = vi.fn(async (ms: number) => {
        delays.push(ms);
      });
      let attempts = 0;
      const steps: DagStep[] = [
        {
          id: "x",
          retry: { maxRetries: 3, backoffMs: 10, backoffFactor: 2, maxBackoffMs: 25 },
          run: () => {
            attempts++;
            throw new Error("always fails");
          },
        },
      ];
      const run = await runDag(steps, { sleep });
      expect(run.status).toBe("failed");
      expect(attempts).toBe(4); // initial + 3 retries
      // backoff: 10, 20, then capped at 25 (would be 40)
      expect(delays).toEqual([10, 20, 25]);
    });

    it("marks the step failed after exhausting retries and aborts run (failFast)", async () => {
      const steps: DagStep[] = [
        { id: "boom", retry: { maxRetries: 1 }, run: () => { throw new Error("nope"); } },
        { id: "after", dependsOn: ["boom"], run: () => "should not run" },
      ];
      const run = await runDag(steps, { sleep: noSleep });
      expect(run.status).toBe("failed");
      expect(run.error).toContain("nope");
      // failFast: "after" never even produced a result entry
      expect(run.steps.find((s) => s.stepId === "after")).toBeUndefined();
    });

    it("continues past failures and skips dependents when failFast is false", async () => {
      const steps: DagStep[] = [
        { id: "boom", run: () => { throw new Error("nope"); } },
        { id: "dependent", dependsOn: ["boom"], run: () => "x" },
        { id: "independent", run: () => "ok" },
      ];
      const run = await runDag(steps, { sleep: noSleep, failFast: false });
      expect(run.status).toBe("failed");
      const byId = Object.fromEntries(run.steps.map((s) => [s.stepId, s.status]));
      expect(byId.boom).toBe("failed");
      expect(byId.dependent).toBe("skipped");
      expect(byId.independent).toBe("completed");
      expect(run.outputs.independent).toBe("ok");
    });
  });

  describe("conditional edges", () => {
    it("skips a step whose when() predicate is false, and its dependents", async () => {
      const ran: string[] = [];
      const steps: DagStep[] = [
        { id: "a", run: () => { ran.push("a"); return { enabled: false }; } },
        {
          id: "b",
          dependsOn: ["a"],
          when: (results) => (results.a as { enabled: boolean }).enabled,
          run: () => { ran.push("b"); return "b"; },
        },
        { id: "c", dependsOn: ["b"], run: () => { ran.push("c"); return "c"; } },
      ];
      const run = await runDag(steps, { sleep: noSleep });
      expect(run.status).toBe("completed"); // skips are not failures
      const byId = Object.fromEntries(run.steps.map((s) => [s.stepId, s.status]));
      expect(byId.a).toBe("completed");
      expect(byId.b).toBe("skipped");
      expect(byId.c).toBe("skipped");
      expect(ran).toEqual(["a"]);
    });

    it("runs a step when its when() predicate is true", async () => {
      const steps: DagStep[] = [
        { id: "a", run: () => ({ enabled: true }) },
        {
          id: "b",
          dependsOn: ["a"],
          when: (results) => (results.a as { enabled: boolean }).enabled,
          run: () => "ran",
        },
      ];
      const run = await runDag(steps, { sleep: noSleep });
      expect(run.outputs.b).toBe("ran");
    });
  });

  describe("cancellation", () => {
    it("returns cancelled when the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const steps: DagStep[] = [{ id: "a", run: () => "x" }];
      const run = await runDag(steps, { sleep: noSleep, signal: controller.signal });
      expect(run.status).toBe("cancelled");
      expect(run.steps).toHaveLength(0);
    });
  });
});
