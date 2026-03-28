import { describe, it, expect, beforeEach } from "vitest";
import { AuditLogger, LogAuditBackend } from "../../gateway/src/audit/logger.js";

describe("AuditLogger", () => {
  let logger: AuditLogger;
  let backend: LogAuditBackend;

  beforeEach(() => {
    backend = new LogAuditBackend();
    logger = new AuditLogger([backend]);
  });

  describe("logAuth", () => {
    it("logs successful login", async () => {
      await logger.logAuth("auth.login", "user-1", true);
      const events = await logger.query({ eventType: "auth.login" });
      expect(events).toHaveLength(1);
      expect(events[0].actorId).toBe("user-1");
      expect(events[0].success).toBe(true);
    });

    it("logs failed login", async () => {
      await logger.logAuth("auth.login_failed", undefined, false, { reason: "bad password" });
      const events = await logger.query({ eventType: "auth.login_failed" });
      expect(events).toHaveLength(1);
      expect(events[0].success).toBe(false);
      expect(events[0].metadata?.reason).toBe("bad password");
    });

    it("logs registration", async () => {
      await logger.logAuth("auth.register", "user-2", true);
      const events = await logger.query({ eventType: "auth.register" });
      expect(events).toHaveLength(1);
    });
  });

  describe("logSession", () => {
    it("logs session creation", async () => {
      await logger.logSession("session.created", "session-1", "user-1", { channel: "webchat" });
      const events = await logger.query({ sessionId: "session-1" });
      expect(events).toHaveLength(1);
      expect(events[0].resourceType).toBe("session");
    });

    it("logs session termination", async () => {
      await logger.logSession("session.terminated", "session-1");
      const events = await logger.query({ eventType: "session.terminated" });
      expect(events).toHaveLength(1);
    });
  });

  describe("logToolExec", () => {
    it("logs successful tool execution", async () => {
      await logger.logToolExec("tool.executed", "web_search", "session-1", true, { query: "test" });
      const events = await logger.query({ eventType: "tool.executed" });
      expect(events).toHaveLength(1);
      expect(events[0].resourceId).toBe("web_search");
    });

    it("logs tool rejection", async () => {
      await logger.logToolExec("tool.rejected", "shell_exec", "session-1", false);
      const events = await logger.query({ eventType: "tool.rejected" });
      expect(events).toHaveLength(1);
      expect(events[0].success).toBe(false);
    });
  });

  describe("logConfigChange", () => {
    it("logs config update", async () => {
      await logger.logConfigChange("admin-1", "agent-config", { field: "model" });
      const events = await logger.query({ eventType: "config.updated" });
      expect(events).toHaveLength(1);
      expect(events[0].actorId).toBe("admin-1");
    });
  });

  describe("query", () => {
    it("filters by event type", async () => {
      await logger.logAuth("auth.login", "user-1", true);
      await logger.logSession("session.created", "session-1");
      await logger.logToolExec("tool.executed", "search");

      const authEvents = await logger.query({ eventType: "auth.login" });
      expect(authEvents).toHaveLength(1);
    });

    it("filters by actor", async () => {
      await logger.logAuth("auth.login", "user-1", true);
      await logger.logAuth("auth.login", "user-2", true);

      const events = await logger.query({ actorId: "user-1" });
      expect(events).toHaveLength(1);
    });

    it("filters by time range", async () => {
      const before = Date.now();
      await logger.logAuth("auth.login", "user-1", true);

      const events = await logger.query({ since: before });
      expect(events).toHaveLength(1);
    });

    it("respects limit", async () => {
      for (let i = 0; i < 10; i++) {
        await logger.logAuth("auth.login", `user-${i}`, true);
      }
      const events = await logger.query({ limit: 3 });
      expect(events).toHaveLength(3);
    });
  });
});
