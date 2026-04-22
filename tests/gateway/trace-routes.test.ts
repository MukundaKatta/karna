import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { TraceCollector } from "../../gateway/src/observability/trace-collector.js";
import { registerTraceRoutes } from "../../gateway/src/routes/traces.js";

describe("trace routes", () => {
  let app: ReturnType<typeof Fastify>;
  let collector: TraceCollector;

  beforeEach(async () => {
    app = Fastify();
    collector = new TraceCollector();
    registerTraceRoutes(app, collector);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("lists filtered traces and includes active traces when requested", async () => {
    const completedId = collector.startTrace("session-1", "agent-1");
    const toolSpanId = collector.startSpan(completedId, "web_search", "tool");
    collector.endSpan(completedId, toolSpanId);
    collector.endTrace(completedId, {
      success: true,
      agentId: "agent-1",
      model: "",
      inputTokens: 12,
      outputTokens: 18,
    });

    const activeId = collector.startTrace("session-2", "agent-2");
    collector.startSpan(activeId, "agent-turn", "model");

    const response = await app.inject({
      method: "GET",
      url: "/api/traces?includeActive=true&toolName=web_search",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().traces).toHaveLength(1);
    expect(response.json().traces[0].traceId).toBe(completedId);
    expect(response.json().active).toBe(1);
  });

  it("returns stats and individual traces", async () => {
    const traceId = collector.startTrace("session-1", "agent-1");
    const modelSpanId = collector.startSpan(traceId, "agent-turn", "model");
    collector.endSpan(traceId, modelSpanId);
    collector.endTrace(traceId, {
      success: false,
      agentId: "agent-1",
      model: "",
      inputTokens: 4,
      outputTokens: 2,
      error: "failed",
    });

    const stats = await app.inject({
      method: "GET",
      url: "/api/traces/stats?periodMs=60000",
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().stats.totalTraces).toBe(1);
    expect(stats.json().stats.errorRate).toBe(1);

    const trace = await app.inject({
      method: "GET",
      url: `/api/traces/${traceId}`,
    });
    expect(trace.statusCode).toBe(200);
    expect(trace.json().trace.traceId).toBe(traceId);
  });

  it("rejects invalid trace filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/traces?success=maybe",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("success");
  });
});
