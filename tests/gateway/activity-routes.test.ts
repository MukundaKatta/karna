import { beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { AuditLogger, LogAuditBackend } from "../../gateway/src/audit/logger.js";
import { registerActivityRoutes } from "../../gateway/src/routes/activity.js";

describe("activity routes", () => {
  let app: ReturnType<typeof Fastify>;
  let auditLogger: AuditLogger;

  beforeEach(async () => {
    app = Fastify();
    auditLogger = new AuditLogger([new LogAuditBackend()]);
    registerActivityRoutes(app, auditLogger);
    await app.ready();
  });

  it("returns filtered audit events in reverse chronological order", async () => {
    await auditLogger.logAuth("auth.login", "user-1", true);
    await auditLogger.logSession("session.created", "session-1", "user-1");
    await auditLogger.logToolExec("tool.executed", "web_search", "session-1", true);

    const response = await app.inject({
      method: "GET",
      url: "/api/activity?sessionId=session-1&limit=2",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().events).toHaveLength(2);
    expect(response.json().events[0].timestamp).toBeGreaterThanOrEqual(
      response.json().events[1].timestamp,
    );
    expect(response.json().events.every((event: { sessionId?: string }) => event.sessionId === "session-1")).toBe(true);
  });

  it("supports event type filtering", async () => {
    await auditLogger.logAuth("auth.login", "user-1", true);
    await auditLogger.logSession("session.created", "session-1", "user-1");

    const response = await app.inject({
      method: "GET",
      url: "/api/activity?eventType=auth.login",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().events).toHaveLength(1);
    expect(response.json().events[0].eventType).toBe("auth.login");
  });

  it("rejects invalid activity filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/activity?eventType=not-real",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Invalid eventType");
  });
});
