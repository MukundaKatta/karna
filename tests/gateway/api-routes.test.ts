import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { TraceCollector } from "../../gateway/src/observability/trace-collector.js";
import { AuditLogger, LogAuditBackend } from "../../gateway/src/audit/logger.js";
import { registerApiRoutes } from "../../gateway/src/routes/api.js";

describe("catalog api routes", () => {
  let app: ReturnType<typeof Fastify>;
  let traceCollector: TraceCollector;
  let auditLogger: AuditLogger;

  beforeEach(async () => {
    app = Fastify();
    traceCollector = new TraceCollector();
    auditLogger = new AuditLogger([new LogAuditBackend()]);
    registerApiRoutes(app, {
      traceCollector,
      auditLogger,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("lists real agents and tools with trace-backed activity", async () => {
    const traceId = traceCollector.startTrace("session-1", "karna-coder");
    const spanId = traceCollector.startSpan(traceId, "web_search", "tool");
    traceCollector.endSpan(traceId, spanId);
    traceCollector.endTrace(traceId, {
      success: true,
      agentId: "karna-coder",
      model: "",
      inputTokens: 11,
      outputTokens: 19,
    });

    const agents = await app.inject({
      method: "GET",
      url: "/api/agents",
    });
    expect(agents.statusCode).toBe(200);
    expect(agents.json().agents.find((agent: { id: string }) => agent.id === "karna-coder")).toMatchObject({
      id: "karna-coder",
      turns: 1,
    });

    const tools = await app.inject({
      method: "GET",
      url: "/api/tools",
    });
    expect(tools.statusCode).toBe(200);
    expect(tools.json().tools.find((tool: { name: string }) => tool.name === "web_search")).toMatchObject({
      name: "web_search",
      totalCalls: 1,
      failedCalls: 0,
    });
  });

  it("lists built-in skills from the repository catalog", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/skills",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().skills.find((skill: { id: string }) => skill.id === "code-reviewer")).toMatchObject({
      id: "code-reviewer",
      source: "builtin",
    });
  });

  it("returns detailed skill metadata for a single skill", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/skills/code-reviewer",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().skill).toMatchObject({
      id: "code-reviewer",
      source: "builtin",
    });
    expect(response.json().skill.triggerDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "command",
          value: "/review",
        }),
      ]),
    );
    expect(response.json().skill.actionDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "review",
        }),
      ]),
    );
  });

  it("builds analytics history from real traces and audit events", async () => {
    const traceId = traceCollector.startTrace("session-1", "karna-general");
    const spanId = traceCollector.startSpan(traceId, "calendar_create", "tool");
    traceCollector.endSpan(traceId, spanId);
    traceCollector.endTrace(traceId, {
      success: false,
      agentId: "karna-general",
      model: "",
      inputTokens: 5,
      outputTokens: 7,
      costUsd: 0.01,
      error: "failed",
    });
    await auditLogger.logSession("session.created", "session-1", "user-1");

    const response = await app.inject({
      method: "GET",
      url: "/api/analytics/history?period=7d",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().totals).toMatchObject({
      messages: 1,
      tokens: 12,
      sessions: 1,
      toolCalls: 1,
      errors: 1,
    });
  });

  it("rejects invalid analytics periods and missing agents", async () => {
    const invalid = await app.inject({
      method: "GET",
      url: "/api/analytics/history?period=90d",
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: "/api/agents/not-real",
    });
    expect(missing.statusCode).toBe(404);

    const missingSkill = await app.inject({
      method: "GET",
      url: "/api/skills/not-real",
    });
    expect(missingSkill.statusCode).toBe(404);
  });
});
