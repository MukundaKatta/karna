import { describe, it, expect } from "vitest";
import {
  runSweTasks,
  makeAssertionVerifier,
  type SweTask,
} from "../../agent/src/evals/task-runner.js";

interface Ctx {
  add: [number, number];
}
type Sol = number;

const tasks: SweTask<Ctx, Sol>[] = [
  { id: "p1", context: { add: [1, 2] }, reference: 3 },
  { id: "p2", context: { add: [10, 5] }, reference: 15 },
  { id: "p3", context: { add: [0, 0] }, reference: 0 },
];

describe("SWE-bench-style task runner", () => {
  it("resolves all tasks when solver is correct", async () => {
    const verify = makeAssertionVerifier<Ctx, Sol>([
      {
        name: "equals-reference",
        check: (t, s) => s === t.reference,
      },
    ]);
    const report = await runSweTasks(
      "adder",
      tasks,
      (t) => t.context.add[0] + t.context.add[1],
      verify,
    );
    expect(report.total).toBe(3);
    expect(report.resolved).toBe(3);
    expect(report.resolveRate).toBe(1);
    expect(report.meanScore).toBe(1);
  });

  it("reports unresolved tasks with partial credit", async () => {
    const verify = makeAssertionVerifier<Ctx, Sol>([
      { name: "positive", check: (_t, s) => s > 0 },
      { name: "equals-reference", check: (t, s) => s === t.reference },
    ]);
    // Solver always returns 1: p1 fails ref (1!=3) but positive passes → 0.5.
    const report = await runSweTasks("buggy", tasks, () => 1, verify);
    expect(report.resolved).toBe(0);
    const p1 = report.results.find((r) => r.taskId === "p1");
    expect(p1?.score).toBeCloseTo(0.5, 5);
    expect(p1?.verification?.detail).toContain("equals-reference");
  });

  it("captures solver errors as unresolved score-0 tasks", async () => {
    const verify = makeAssertionVerifier<Ctx, Sol>([
      { name: "ok", check: () => true },
    ]);
    const report = await runSweTasks(
      "throwing",
      tasks,
      (t) => {
        if (t.id === "p2") throw new Error("solver failed");
        return t.context.add[0] + t.context.add[1];
      },
      verify,
    );
    const p2 = report.results.find((r) => r.taskId === "p2");
    expect(p2?.resolved).toBe(false);
    expect(p2?.score).toBe(0);
    expect(p2?.error).toBe("solver failed");
    expect(report.resolved).toBe(2);
  });
});
