import { describe, it, expect } from "vitest";
import {
  runSuite,
  defineDataset,
  defineScorer,
  exactMatchScorer,
  type Suite,
} from "../../agent/src/evals/framework.js";

describe("evals framework: runSuite", () => {
  const dataset = defineDataset<number, number>("doubler", [
    { id: "t1", input: 2, expected: 4 },
    { id: "t2", input: 3, expected: 6 },
    { id: "t3", input: 5, expected: 10 },
  ]);

  it("scores exact matches and aggregates pass/fail", async () => {
    const suite: Suite<number, number, number> = {
      name: "double-exact",
      dataset,
      scorers: [exactMatchScorer<number, number>()],
    };
    const report = await runSuite(suite, (x) => x * 2);
    expect(report.total).toBe(3);
    expect(report.passed).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.passRate).toBe(1);
    expect(report.meanScore).toBe(1);
  });

  it("marks failing tasks when runner is wrong", async () => {
    const suite: Suite<number, number, number> = {
      name: "double-buggy",
      dataset,
      scorers: [exactMatchScorer<number, number>()],
    };
    const report = await runSuite(suite, (x) => x * 2 + 1);
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(3);
    expect(report.passRate).toBe(0);
  });

  it("captures runner errors as failed tasks without aborting", async () => {
    const suite: Suite<number, number, number> = {
      name: "throwing",
      dataset,
      scorers: [exactMatchScorer<number, number>()],
    };
    const report = await runSuite(suite, (x) => {
      if (x === 3) throw new Error("boom");
      return x * 2;
    });
    expect(report.total).toBe(3);
    expect(report.passed).toBe(2);
    const failing = report.tasks.find((t) => t.taskId === "t2");
    expect(failing?.passed).toBe(false);
    expect(failing?.error).toBe("boom");
  });

  it("honors the configurable passThreshold for graded scorers", async () => {
    const graded = defineScorer<number, number, number>("ratio", (task, out) => {
      const score = out / (task.expected ?? 1);
      return { score };
    });
    const suite: Suite<number, number, number> = {
      name: "graded",
      dataset,
      scorers: [graded],
      passThreshold: 0.8,
    };
    // Runner returns 90% of expected → score 0.9 ≥ 0.8 → pass.
    const report = await runSuite(suite, (x, t) => (t.expected ?? 0) * 0.9);
    expect(report.passed).toBe(3);

    // Now 0.5 < 0.8 → fail.
    const suite2 = { ...suite };
    const report2 = await runSuite(suite2, (x, t) => (t.expected ?? 0) * 0.5);
    expect(report2.failed).toBe(3);
  });

  it("produces a JSON-serializable report", async () => {
    const suite: Suite<number, number, number> = {
      name: "json",
      dataset,
      scorers: [exactMatchScorer<number, number>()],
    };
    const report = await runSuite(suite, (x) => x * 2);
    expect(() => JSON.stringify(report)).not.toThrow();
    const round = JSON.parse(JSON.stringify(report));
    expect(round.suite).toBe("json");
  });
});
