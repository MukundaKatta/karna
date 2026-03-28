import { describe, it, expect } from "vitest";
import { MetricsCollector } from "../../gateway/src/health/metrics.js";

describe("Cost Calculation Accuracy", () => {
  it("calculates Claude Sonnet 4 cost correctly", () => {
    const collector = new MetricsCollector();
    // Pricing: input=0.003/1k, output=0.015/1k
    collector.recordUsage("claude-sonnet-4-20250514", 10_000, 5_000);
    const m = collector.getMetrics();
    const expected = (10_000 / 1000) * 0.003 + (5_000 / 1000) * 0.015;
    expect(m.totalCostUsd).toBeCloseTo(expected, 5);
  });

  it("calculates Claude Opus 4 cost correctly", () => {
    const collector = new MetricsCollector();
    // Pricing: input=0.015/1k, output=0.075/1k
    collector.recordUsage("claude-opus-4-20250514", 10_000, 5_000);
    const m = collector.getMetrics();
    const expected = (10_000 / 1000) * 0.015 + (5_000 / 1000) * 0.075;
    expect(m.totalCostUsd).toBeCloseTo(expected, 5);
  });

  it("calculates GPT-4o cost correctly", () => {
    const collector = new MetricsCollector();
    // Pricing: input=0.005/1k, output=0.015/1k
    collector.recordUsage("gpt-4o", 10_000, 5_000);
    const m = collector.getMetrics();
    const expected = (10_000 / 1000) * 0.005 + (5_000 / 1000) * 0.015;
    expect(m.totalCostUsd).toBeCloseTo(expected, 5);
  });

  it("calculates GPT-4o-mini cost correctly", () => {
    const collector = new MetricsCollector();
    // Pricing: input=0.00015/1k, output=0.0006/1k
    collector.recordUsage("gpt-4o-mini", 100_000, 50_000);
    const m = collector.getMetrics();
    const expected = (100_000 / 1000) * 0.00015 + (50_000 / 1000) * 0.0006;
    expect(m.totalCostUsd).toBeCloseTo(expected, 5);
  });

  it("handles zero tokens", () => {
    const collector = new MetricsCollector();
    collector.recordUsage("claude-sonnet-4-20250514", 0, 0);
    const m = collector.getMetrics();
    expect(m.totalCostUsd).toBe(0);
    expect(m.totalRequests).toBe(1);
  });

  it("accumulates cost across multiple models", () => {
    const collector = new MetricsCollector();
    collector.recordUsage("claude-sonnet-4-20250514", 1000, 500);
    collector.recordUsage("gpt-4o", 2000, 1000);

    const m = collector.getMetrics();
    const sonnetCost = (1000 / 1000) * 0.003 + (500 / 1000) * 0.015;
    const gptCost = (2000 / 1000) * 0.005 + (1000 / 1000) * 0.015;
    expect(m.totalCostUsd).toBeCloseTo(sonnetCost + gptCost, 5);
  });
});
