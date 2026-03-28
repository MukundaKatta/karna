import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector } from "../../gateway/src/health/metrics.js";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  it("starts with zero metrics", () => {
    const m = collector.getMetrics();
    expect(m.totalTokens).toBe(0);
    expect(m.totalRequests).toBe(0);
    expect(m.totalCostUsd).toBe(0);
    expect(Object.keys(m.byModel)).toHaveLength(0);
  });

  it("records usage for a single model", () => {
    collector.recordUsage("claude-sonnet-4-20250514", 1000, 500);
    const m = collector.getMetrics();
    expect(m.totalInputTokens).toBe(1000);
    expect(m.totalOutputTokens).toBe(500);
    expect(m.totalTokens).toBe(1500);
    expect(m.totalRequests).toBe(1);
    expect(m.totalCostUsd).toBeGreaterThan(0);
  });

  it("calculates cost correctly for known models", () => {
    // claude-sonnet-4-20250514: input=0.003/1k, output=0.015/1k
    collector.recordUsage("claude-sonnet-4-20250514", 1000, 1000);
    const m = collector.getMetrics();
    const expectedCost = (1000 / 1000) * 0.003 + (1000 / 1000) * 0.015;
    expect(m.totalCostUsd).toBeCloseTo(expectedCost, 5);
  });

  it("returns zero cost for unknown models", () => {
    collector.recordUsage("unknown-model", 1000, 500);
    const m = collector.getMetrics();
    expect(m.totalCostUsd).toBe(0);
    expect(m.totalTokens).toBe(1500);
  });

  it("accumulates across multiple usage records", () => {
    collector.recordUsage("claude-sonnet-4-20250514", 100, 50);
    collector.recordUsage("claude-sonnet-4-20250514", 200, 100);
    collector.recordUsage("gpt-4o", 300, 150);

    const m = collector.getMetrics();
    expect(m.totalInputTokens).toBe(600);
    expect(m.totalOutputTokens).toBe(300);
    expect(m.totalRequests).toBe(3);
    expect(Object.keys(m.byModel)).toHaveLength(2);
  });

  it("tracks per-model breakdown", () => {
    collector.recordUsage("claude-sonnet-4-20250514", 100, 50);
    collector.recordUsage("gpt-4o", 200, 100);

    const m = collector.getMetrics();
    expect(m.byModel["claude-sonnet-4-20250514"]?.requestCount).toBe(1);
    expect(m.byModel["gpt-4o"]?.requestCount).toBe(1);
    expect(m.byModel["gpt-4o"]?.inputTokens).toBe(200);
  });

  it("resets all metrics", () => {
    collector.recordUsage("claude-sonnet-4-20250514", 1000, 500);
    collector.reset();
    const m = collector.getMetrics();
    expect(m.totalTokens).toBe(0);
    expect(m.totalRequests).toBe(0);
    expect(Object.keys(m.byModel)).toHaveLength(0);
  });

  it("supports custom pricing", () => {
    const custom = new MetricsCollector({
      "my-model": { input: 0.01, output: 0.05 },
    });
    custom.recordUsage("my-model", 1000, 1000);
    const m = custom.getMetrics();
    const expectedCost = (1000 / 1000) * 0.01 + (1000 / 1000) * 0.05;
    expect(m.totalCostUsd).toBeCloseTo(expectedCost, 5);
  });

  it("includes collection duration", () => {
    const m = collector.getMetrics();
    expect(m.collectionDurationMs).toBeGreaterThanOrEqual(0);
    expect(m.startedAt).toBeLessThanOrEqual(Date.now());
  });

  describe("Prometheus format", () => {
    it("outputs valid Prometheus text exposition", () => {
      collector.recordUsage("claude-sonnet-4-20250514", 1000, 500);
      const text = collector.getPrometheusMetrics(5, 10);

      expect(text).toContain("# HELP karna_requests_total");
      expect(text).toContain("# TYPE karna_requests_total counter");
      expect(text).toContain("karna_requests_total 1");
      expect(text).toContain('karna_tokens_total{direction="input"} 1000');
      expect(text).toContain('karna_tokens_total{direction="output"} 500');
      expect(text).toContain("karna_active_connections 5");
      expect(text).toContain("karna_active_sessions 10");
    });

    it("includes per-model breakdown", () => {
      collector.recordUsage("claude-sonnet-4-20250514", 100, 50);
      collector.recordUsage("gpt-4o", 200, 100);
      const text = collector.getPrometheusMetrics();

      expect(text).toContain('karna_model_requests_total{model="claude-sonnet-4-20250514"} 1');
      expect(text).toContain('karna_model_requests_total{model="gpt-4o"} 1');
      expect(text).toContain('karna_model_tokens_total{model="gpt-4o",direction="input"} 200');
    });

    it("returns empty metrics when nothing recorded", () => {
      const text = collector.getPrometheusMetrics();
      expect(text).toContain("karna_requests_total 0");
      expect(text).toContain("karna_active_connections 0");
    });

    it("ends with newline", () => {
      const text = collector.getPrometheusMetrics();
      expect(text.endsWith("\n")).toBe(true);
    });
  });
});
