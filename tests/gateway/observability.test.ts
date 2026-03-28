import { describe, it, expect, beforeEach } from "vitest";
import { TraceCollector } from "../../gateway/src/observability/trace-collector.js";

describe("TraceCollector", () => {
  let collector: TraceCollector;

  beforeEach(() => {
    collector = new TraceCollector();
  });

  // ─── Trace Lifecycle ──────────────────────────────────────────────────────

  describe("startTrace", () => {
    it("returns a unique trace ID", () => {
      const id1 = collector.startTrace("sess-1", "agent-1");
      const id2 = collector.startTrace("sess-2", "agent-1");
      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });

    it("tracks the trace as active", () => {
      collector.startTrace("sess-1", "agent-1");
      expect(collector.activeCount).toBe(1);
    });
  });

  describe("endTrace", () => {
    it("finalizes a trace with result data", () => {
      const traceId = collector.startTrace("sess-1", "agent-1");
      const trace = collector.endTrace(traceId, {
        success: true,
        model: "claude-sonnet-4-20250514",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.005,
      });

      expect(trace).not.toBeNull();
      expect(trace!.success).toBe(true);
      expect(trace!.model).toBe("claude-sonnet-4-20250514");
      expect(trace!.inputTokens).toBe(100);
      expect(trace!.outputTokens).toBe(50);
      expect(trace!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns null for unknown trace ID", () => {
      const result = collector.endTrace("nonexistent", {
        success: false,
        model: "test",
        inputTokens: 0,
        outputTokens: 0,
      });
      expect(result).toBeNull();
    });

    it("removes trace from active set", () => {
      const traceId = collector.startTrace("sess-1", "agent-1");
      expect(collector.activeCount).toBe(1);
      collector.endTrace(traceId, {
        success: true,
        model: "test",
        inputTokens: 0,
        outputTokens: 0,
      });
      expect(collector.activeCount).toBe(0);
    });

    it("marks open spans as cancelled", () => {
      const traceId = collector.startTrace("sess-1", "agent-1");
      collector.startSpan(traceId, "model-call", "model");

      const trace = collector.endTrace(traceId, {
        success: true,
        model: "test",
        inputTokens: 0,
        outputTokens: 0,
      });

      expect(trace!.spans[0].status).toBe("cancelled");
      expect(trace!.spans[0].endedAt).toBeDefined();
    });

    it("counts tool spans for toolCalls field", () => {
      const traceId = collector.startTrace("sess-1", "agent-1");
      const span1 = collector.startSpan(traceId, "web_search", "tool");
      collector.endSpan(traceId, span1);
      const span2 = collector.startSpan(traceId, "calendar", "tool");
      collector.endSpan(traceId, span2);
      collector.startSpan(traceId, "context-build", "context");

      const trace = collector.endTrace(traceId, {
        success: true,
        model: "test",
        inputTokens: 0,
        outputTokens: 0,
      });

      expect(trace!.toolCalls).toBe(2);
    });
  });

  // ─── Span Operations ──────────────────────────────────────────────────────

  describe("startSpan", () => {
    it("creates a span within a trace", () => {
      const traceId = collector.startTrace("sess-1", "agent-1");
      const spanId = collector.startSpan(traceId, "model-call", "model");
      expect(spanId).toBeTruthy();
    });

    it("returns empty string for unknown trace", () => {
      const spanId = collector.startSpan("nonexistent", "test", "custom");
      expect(spanId).toBe("");
    });

    it("supports parent span ID", () => {
      const traceId = collector.startTrace("sess-1", "agent-1");
      const parentSpan = collector.startSpan(traceId, "agent-turn", "custom");
      const childSpan = collector.startSpan(traceId, "tool-exec", "tool", parentSpan);
      expect(childSpan).toBeTruthy();
      expect(childSpan).not.toBe(parentSpan);
    });
  });

  describe("endSpan", () => {
    it("sets duration and endedAt", () => {
      const traceId = collector.startTrace("sess-1", "agent-1");
      const spanId = collector.startSpan(traceId, "test-span", "custom");
      collector.endSpan(traceId, spanId, { result: "ok" });

      const trace = collector.getTrace(traceId);
      const span = trace!.spans.find((s) => s.spanId === spanId);
      expect(span!.endedAt).toBeDefined();
      expect(span!.durationMs).toBeGreaterThanOrEqual(0);
      expect(span!.attributes.result).toBe("ok");
    });
  });

  describe("setSpanError", () => {
    it("marks span as error with message", () => {
      const traceId = collector.startTrace("sess-1", "agent-1");
      const spanId = collector.startSpan(traceId, "failing-tool", "tool");
      collector.setSpanError(traceId, spanId, "Connection refused");

      const trace = collector.getTrace(traceId);
      const span = trace!.spans.find((s) => s.spanId === spanId);
      expect(span!.status).toBe("error");
      expect(span!.attributes.error).toBe("Connection refused");
    });
  });

  describe("addSpanEvent", () => {
    it("appends an event to a span", () => {
      const traceId = collector.startTrace("sess-1", "agent-1");
      const spanId = collector.startSpan(traceId, "tool-exec", "tool");
      collector.addSpanEvent(traceId, spanId, "retry", { attempt: 2 });

      const trace = collector.getTrace(traceId);
      const span = trace!.spans.find((s) => s.spanId === spanId);
      expect(span!.events).toHaveLength(1);
      expect(span!.events[0].name).toBe("retry");
      expect(span!.events[0].attributes?.attempt).toBe(2);
    });
  });

  // ─── Queries ──────────────────────────────────────────────────────────────

  describe("getTraces", () => {
    it("filters by sessionId", () => {
      for (const sessId of ["s1", "s1", "s2"]) {
        const id = collector.startTrace(sessId, "a1");
        collector.endTrace(id, { success: true, model: "t", inputTokens: 0, outputTokens: 0 });
      }
      const results = collector.getTraces({ sessionId: "s1" });
      expect(results).toHaveLength(2);
    });

    it("filters by agentId", () => {
      for (const agentId of ["a1", "a2", "a1"]) {
        const id = collector.startTrace("s1", agentId);
        collector.endTrace(id, { success: true, model: "t", inputTokens: 0, outputTokens: 0 });
      }
      const results = collector.getTraces({ agentId: "a2" });
      expect(results).toHaveLength(1);
    });

    it("respects limit and offset", () => {
      for (let i = 0; i < 10; i++) {
        const id = collector.startTrace("s1", "a1");
        collector.endTrace(id, { success: true, model: "t", inputTokens: 0, outputTokens: 0 });
      }
      const results = collector.getTraces({ limit: 3, offset: 2 });
      expect(results).toHaveLength(3);
    });
  });

  // ─── Stats ────────────────────────────────────────────────────────────────

  describe("getStats", () => {
    it("returns zero stats when no traces exist", () => {
      const stats = collector.getStats();
      expect(stats.totalTraces).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
      expect(stats.errorRate).toBe(0);
      expect(stats.toolSuccessRate).toBe(1);
    });

    it("calculates percentiles correctly", () => {
      for (let i = 0; i < 20; i++) {
        const id = collector.startTrace("s1", "a1");
        collector.endTrace(id, {
          success: true,
          model: "test",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.001,
        });
      }
      const stats = collector.getStats();
      expect(stats.totalTraces).toBe(20);
      expect(stats.avgDurationMs).toBeGreaterThanOrEqual(0);
      expect(stats.p50DurationMs).toBeGreaterThanOrEqual(0);
      expect(stats.p95DurationMs).toBeGreaterThanOrEqual(0);
      expect(stats.totalTokens).toBe(3000); // 20 * (100 + 50)
      expect(stats.totalCostUsd).toBeCloseTo(0.02);
    });

    it("calculates error rate", () => {
      for (let i = 0; i < 4; i++) {
        const id = collector.startTrace("s1", "a1");
        collector.endTrace(id, {
          success: i < 3, // 3 success, 1 failure
          model: "test",
          inputTokens: 0,
          outputTokens: 0,
          error: i >= 3 ? "failed" : undefined,
        });
      }
      const stats = collector.getStats();
      expect(stats.errorRate).toBe(0.25);
    });

    it("calculates tool success rate", () => {
      const traceId = collector.startTrace("s1", "a1");
      const goodSpan = collector.startSpan(traceId, "search", "tool");
      collector.endSpan(traceId, goodSpan);
      const badSpan = collector.startSpan(traceId, "calendar", "tool");
      collector.setSpanError(traceId, badSpan, "failed");
      collector.endSpan(traceId, badSpan);

      collector.endTrace(traceId, {
        success: true,
        model: "test",
        inputTokens: 0,
        outputTokens: 0,
      });

      const stats = collector.getStats();
      expect(stats.toolSuccessRate).toBe(0.5);
    });
  });

  // ─── Ring Buffer ──────────────────────────────────────────────────────────

  describe("ring buffer eviction", () => {
    it("evicts oldest traces when maxTraces exceeded", () => {
      const small = new TraceCollector(5);
      for (let i = 0; i < 8; i++) {
        const id = small.startTrace("s1", "a1");
        small.endTrace(id, { success: true, model: "t", inputTokens: 0, outputTokens: 0 });
      }
      expect(small.size).toBe(5);
    });
  });
});
