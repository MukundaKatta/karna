import { describe, it, expect, beforeEach } from "vitest";
import { SessionManager } from "../../gateway/src/session/manager.js";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({
      maxSessions: 10,
      sessionTimeoutMs: 60_000,
      flushIntervalMs: 300_000, // Long interval to avoid flushes during tests
    });
  });

  describe("createSession", () => {
    it("creates a session with correct fields", () => {
      const session = manager.createSession("agent-1", "webchat", "user-1");
      expect(session.id).toBeTruthy();
      expect(session.channelType).toBe("webchat");
      expect(session.channelId).toBe("agent-1");
      expect(session.userId).toBe("user-1");
      expect(session.status).toBe("active");
      expect(session.stats?.messageCount).toBe(0);
    });

    it("creates session without userId", () => {
      const session = manager.createSession("agent-1", "telegram");
      expect(session.userId).toBeUndefined();
    });

    it("preserves session metadata from the caller", () => {
      const session = manager.createSession("agent-1", "discord", "user-1", {
        isDirectMessage: false,
        channelId: "channel-123",
      });

      expect(session.metadata).toEqual({
        isDirectMessage: false,
        channelId: "channel-123",
      });
    });

    it("increments active session count", () => {
      expect(manager.activeSessionCount).toBe(0);
      manager.createSession("agent-1", "webchat");
      expect(manager.activeSessionCount).toBe(1);
      manager.createSession("agent-2", "webchat");
      expect(manager.activeSessionCount).toBe(2);
    });
  });

  describe("getSession", () => {
    it("retrieves an existing session", () => {
      const created = manager.createSession("agent-1", "webchat");
      const retrieved = manager.getSession(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
    });

    it("returns null for non-existent session", () => {
      expect(manager.getSession("non-existent")).toBeNull();
    });

    it("returns null for expired session", () => {
      const expiredManager = new SessionManager({
        sessionTimeoutMs: 1, // 1ms timeout
      });
      const session = expiredManager.createSession("agent-1", "webchat");

      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }

      expect(expiredManager.getSession(session.id)).toBeNull();
    });
  });

  describe("listSessions", () => {
    it("lists sessions for an agent", () => {
      manager.createSession("agent-1", "webchat", "user-1");
      manager.createSession("agent-1", "telegram", "user-2");
      manager.createSession("agent-2", "webchat", "user-3");

      const sessions = manager.listSessions("agent-1");
      expect(sessions.length).toBe(2);
    });

    it("returns empty for unknown agent", () => {
      expect(manager.listSessions("unknown")).toEqual([]);
    });
  });

  describe("listAllSessions", () => {
    it("lists all active sessions", () => {
      manager.createSession("agent-1", "webchat");
      manager.createSession("agent-2", "telegram");
      const all = manager.listAllSessions();
      expect(all.length).toBe(2);
    });
  });

  describe("updateSessionStatus", () => {
    it("updates status successfully", () => {
      const session = manager.createSession("agent-1", "webchat");
      expect(manager.updateSessionStatus(session.id, "suspended")).toBe(true);
      const updated = manager.getSession(session.id);
      expect(updated?.status).toBe("suspended");
    });

    it("returns false for non-existent session", () => {
      expect(manager.updateSessionStatus("non-existent", "idle")).toBe(false);
    });
  });

  describe("updateSessionStats", () => {
    it("updates token counts", () => {
      const session = manager.createSession("agent-1", "webchat");
      manager.updateSessionStats(session.id, 100, 50, 0.001);

      const updated = manager.getSession(session.id);
      expect(updated?.stats?.messageCount).toBe(1);
      expect(updated?.stats?.totalInputTokens).toBe(100);
      expect(updated?.stats?.totalOutputTokens).toBe(50);
      expect(updated?.stats?.totalCostUsd).toBe(0.001);
    });

    it("accumulates stats across updates", () => {
      const session = manager.createSession("agent-1", "webchat");
      manager.updateSessionStats(session.id, 100, 50, 0.001);
      manager.updateSessionStats(session.id, 200, 100, 0.002);

      const updated = manager.getSession(session.id);
      expect(updated?.stats?.messageCount).toBe(2);
      expect(updated?.stats?.totalInputTokens).toBe(300);
      expect(updated?.stats?.totalOutputTokens).toBe(150);
    });
  });

  describe("terminateSession", () => {
    it("terminates and removes session", () => {
      const session = manager.createSession("agent-1", "webchat");
      expect(manager.terminateSession(session.id)).toBe(true);
      expect(manager.getSession(session.id)).toBeNull();
      expect(manager.activeSessionCount).toBe(0);
    });

    it("returns false for non-existent session", () => {
      expect(manager.terminateSession("non-existent")).toBe(false);
    });
  });

  describe("eviction", () => {
    it("evicts oldest session when at capacity", () => {
      const smallManager = new SessionManager({ maxSessions: 2 });
      const first = smallManager.createSession("agent-1", "webchat");
      smallManager.createSession("agent-2", "webchat");

      // This should trigger eviction of the oldest
      const third = smallManager.createSession("agent-3", "webchat");
      expect(smallManager.activeSessionCount).toBeLessThanOrEqual(2);
      expect(smallManager.getSession(first.id)).toBeNull(); // First should be evicted
      expect(smallManager.getSession(third.id)).not.toBeNull();
    });
  });
});
