import { describe, it, expect } from "vitest";
import {
  runLatencyCostBench,
  detectRegression,
  toBaseline,
  type LatencyCostCase,
  type RunMeasurement,
} from "../../agent/src/evals/latency-cost-bench.js";
import { calculateCost } from "@karna/shared";

const cases: LatencyCostCase<string>[] = [
  { id: "c1", input: "hi", model: "claude-sonnet-4-20250514" },
  { id: "c2", input: "yo", model: "claude-sonnet-4-20250514" },
];

describe("latency & cost benchmark", () => {
  it("measures latency and computes cost via shared cost utils", async () => {
    const usage = { inputTokens: 1000, outputTokens: 500 };
    const runner = (): RunMeasurement => ({ ttftMs: 100, totalMs: 300, usage });
    const report = await runLatencyCostBench("bench", cases, runner);

    expect(report.total).toBe(2);
    expect(report.meanTtftMs).toBe(100);
    expect(report.meanTotalMs).toBe(300);

    const expectedPerRun = calculateCost("claude-sonnet-4-20250514", usage).totalCost;
    expect(report.totalCostUsd).toBeCloseTo(expectedPerRun * 2, 10);
  });

  it("tolerates unknown model pricing (cost 0, timing kept)", async () => {
    const unknown: LatencyCostCase<string>[] = [
      { id: "u1", input: "x", model: "totally-made-up-model" },
    ];
    const report = await runLatencyCostBench("u", unknown, () => ({
      ttftMs: 5,
      totalMs: 9,
      usage: { inputTokens: 10, outputTokens: 10 },
    }));
    expect(report.totalCostUsd).toBe(0);
    expect(report.meanTotalMs).toBe(9);
  });

  it("detects regression beyond tolerance", () => {
    const baseline = {
      meanTtftMs: 100,
      p95TtftMs: 120,
      meanTotalMs: 300,
      p95TotalMs: 350,
      totalCostUsd: 0.01,
    };
    const current = { ...baseline, meanTotalMs: 360 }; // +20% > 10% tolerance
    const result = detectRegression(baseline, current, 0.1);
    expect(result.regressed).toBe(true);
    expect(result.regressions[0].metric).toBe("meanTotalMs");
    expect(result.regressions[0].ratio).toBeCloseTo(0.2, 5);
  });

  it("does not flag within tolerance", () => {
    const baseline = {
      meanTtftMs: 100,
      p95TtftMs: 120,
      meanTotalMs: 300,
      p95TotalMs: 350,
      totalCostUsd: 0.01,
    };
    const current = { ...baseline, meanTotalMs: 315 }; // +5% < 10%
    expect(detectRegression(baseline, current, 0.1).regressed).toBe(false);
  });

  it("toBaseline extracts the baseline subset from a report", async () => {
    const report = await runLatencyCostBench("b", cases, () => ({
      ttftMs: 10,
      totalMs: 20,
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const baseline = toBaseline(report);
    expect(baseline.meanTtftMs).toBe(report.meanTtftMs);
    expect(baseline).not.toHaveProperty("results");
  });
});
