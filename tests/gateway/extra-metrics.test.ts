import { describe, it, expect, beforeEach } from "vitest";
import {
  ExtraMetricsRegistry,
  Histogram,
  Counter,
  Gauge,
  DEFAULT_LATENCY_BUCKETS_MS,
} from "../../gateway/src/health/extra-metrics.js";
import { MetricsCollector } from "../../gateway/src/health/metrics.js";

const TS = 1_700_000_000_000;

describe("extra-metrics primitives", () => {
  describe("Counter", () => {
    it("accumulates per label set", () => {
      const c = new Counter("karna_test_total", "test counter");
      c.inc({ a: "1" });
      c.inc({ a: "1" }, 4);
      c.inc({ a: "2" });
      const text = c.render(TS).join("\n");
      expect(text).toContain("# TYPE karna_test_total counter");
      expect(text).toContain(`karna_test_total{a="1"} 5 ${TS}`);
      expect(text).toContain(`karna_test_total{a="2"} 1 ${TS}`);
    });

    it("renders unlabelled series without braces", () => {
      const c = new Counter("karna_plain_total", "plain");
      c.inc();
      expect(c.render(TS).join("\n")).toContain(`karna_plain_total 1 ${TS}`);
    });
  });

  describe("Gauge", () => {
    it("sets, increments, and decrements", () => {
      const g = new Gauge("karna_gauge", "gauge");
      g.set(10, { q: "main" });
      g.inc({ q: "main" }, 5);
      g.dec({ q: "main" }, 3);
      expect(g.render(TS).join("\n")).toContain(`karna_gauge{q="main"} 12 ${TS}`);
    });
  });

  describe("Histogram", () => {
    it("emits cumulative buckets, +Inf, sum, and count", () => {
      const h = new Histogram("karna_lat_ms", "latency", [10, 100, 1000]);
      h.observe(5);
      h.observe(50);
      h.observe(5000);
      const lines = h.render(TS);
      const text = lines.join("\n");
      expect(text).toContain("# TYPE karna_lat_ms histogram");
      // cumulative: le=10 -> 1, le=100 -> 2, le=1000 -> 2, +Inf -> 3
      expect(text).toContain(`karna_lat_ms_bucket{le="10"} 1 ${TS}`);
      expect(text).toContain(`karna_lat_ms_bucket{le="100"} 2 ${TS}`);
      expect(text).toContain(`karna_lat_ms_bucket{le="1000"} 2 ${TS}`);
      expect(text).toContain(`karna_lat_ms_bucket{le="+Inf"} 3 ${TS}`);
      expect(text).toContain(`karna_lat_ms_sum 5055 ${TS}`);
      expect(text).toContain(`karna_lat_ms_count 3 ${TS}`);
    });

    it("sorts and de-duplicates bucket boundaries", () => {
      const h = new Histogram("karna_b", "b", [1000, 10, 10, 100]);
      h.observe(5);
      const text = h.render(TS).join("\n");
      const order = ["10", "100", "1000"].map((le) =>
        text.indexOf(`le="${le}"`),
      );
      expect(order[0]).toBeLessThan(order[1]!);
      expect(order[1]).toBeLessThan(order[2]!);
    });

    it("keeps per-label series separate", () => {
      const h = new Histogram("karna_tool_ms", "tool", [100]);
      h.observe(50, { tool: "search" });
      h.observe(50, { tool: "calendar" });
      const text = h.render(TS).join("\n");
      expect(text).toContain('karna_tool_ms_count{tool="search"} 1');
      expect(text).toContain('karna_tool_ms_count{tool="calendar"} 1');
    });

    it("exposes default latency buckets", () => {
      expect(DEFAULT_LATENCY_BUCKETS_MS[0]).toBe(5);
      expect(DEFAULT_LATENCY_BUCKETS_MS).toContain(1000);
    });
  });
});

describe("ExtraMetricsRegistry", () => {
  let reg: ExtraMetricsRegistry;

  beforeEach(() => {
    reg = new ExtraMetricsRegistry();
  });

  it("records tool latency labelled by tool and status", () => {
    reg.recordToolLatency("web_search", 120, true);
    reg.recordToolLatency("web_search", 80, false);
    const text = reg.render(TS);
    expect(text).toContain('karna_tool_latency_ms_count{status="ok",tool="web_search"} 1');
    expect(text).toContain('karna_tool_latency_ms_count{status="error",tool="web_search"} 1');
  });

  it("records model latency and detailed tokens", () => {
    reg.recordModelLatency("gpt-4o", 900);
    reg.recordModelTokens("gpt-4o", 1000, 500);
    const text = reg.render(TS);
    expect(text).toContain('karna_model_latency_ms_count{model="gpt-4o"} 1');
    expect(text).toContain('karna_model_tokens_detailed_total{direction="input",model="gpt-4o"} 1000');
    expect(text).toContain('karna_model_tokens_detailed_total{direction="output",model="gpt-4o"} 500');
  });

  it("records memory ops by op and tier", () => {
    reg.recordMemoryOp("promote", "short_term", 2);
    const text = reg.render(TS);
    expect(text).toContain('karna_memory_operations_total{op="promote",tier="short_term"} 2');
  });

  it("tracks queue depth and active sub-agents", () => {
    reg.setQueueDepth("inbound", 7);
    reg.subAgentStarted();
    reg.subAgentStarted();
    reg.subAgentStopped();
    const text = reg.render(TS);
    expect(text).toContain('karna_queue_depth{queue="inbound"} 7');
    expect(text).toContain(`karna_active_sub_agents 1 ${TS}`);
  });

  it("renders a block ending in a trailing newline", () => {
    reg.setActiveSubAgents(0);
    const text = reg.render(TS);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("resets all families", () => {
    reg.recordToolLatency("t", 1);
    reg.setQueueDepth("q", 9);
    reg.reset();
    const text = reg.render(TS);
    expect(text).not.toContain("karna_tool_latency_ms_count");
    expect(text).not.toContain('karna_queue_depth{queue="q"}');
  });

  describe("appendTo (non-breaking integration with core metrics)", () => {
    it("preserves the existing exporter output verbatim", () => {
      const core = new MetricsCollector();
      core.recordUsage("claude-sonnet-4-20250514", 1000, 500);
      const base = core.getPrometheusMetrics(5, 10);

      reg.recordToolLatency("web_search", 120);
      const combined = reg.appendTo(base, TS);

      // Existing content is untouched.
      expect(combined.startsWith(base)).toBe(true);
      expect(combined).toContain("karna_requests_total 1");
      expect(combined).toContain("karna_active_connections 5");
      // New content is appended.
      expect(combined).toContain("karna_tool_latency_ms_bucket");
    });

    it("does not duplicate or alter any core metric line", () => {
      const core = new MetricsCollector();
      core.recordUsage("gpt-4o", 200, 100);
      const base = core.getPrometheusMetrics();
      reg.recordModelLatency("gpt-4o", 500);
      const combined = reg.appendTo(base, TS);

      const occurrences = combined.split("karna_requests_total 1").length - 1;
      expect(occurrences).toBe(1);
    });

    it("returns the block alone when existing output is empty", () => {
      reg.setQueueDepth("q", 1);
      const combined = reg.appendTo("", TS);
      expect(combined).toBe(reg.render(TS));
    });

    it("inserts a separator newline when existing output lacks one", () => {
      reg.setQueueDepth("q", 1);
      const combined = reg.appendTo("custom_metric 1", TS);
      expect(combined.startsWith("custom_metric 1\n")).toBe(true);
    });
  });
});
