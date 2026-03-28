import { describe, it, expect, beforeEach } from "vitest";
import { PresenceManager } from "../../gateway/src/presence/manager.js";

describe("PresenceManager", () => {
  let pm: PresenceManager;

  beforeEach(() => {
    pm = new PresenceManager(100); // 100ms typing timeout for fast tests
  });

  it("sets user online", () => {
    pm.setOnline("session-1", "user-1");
    const entries = pm.getSessionPresence("session-1");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.presence).toBe("online");
    expect(entries[0]!.typing).toBe("idle");
  });

  it("sets user offline", () => {
    pm.setOnline("session-1", "user-1");
    pm.setOffline("session-1", "user-1");
    const entry = pm.getUserPresence("session-1", "user-1");
    expect(entry?.presence).toBe("offline");
  });

  it("tracks typing state", () => {
    pm.setOnline("session-1", "user-1");
    pm.setTyping("session-1", "user-1");
    const entry = pm.getUserPresence("session-1", "user-1");
    expect(entry?.typing).toBe("typing");
  });

  it("auto-clears typing after timeout", async () => {
    pm.setOnline("session-1", "user-1");
    pm.setTyping("session-1", "user-1");

    await new Promise((r) => setTimeout(r, 150));

    const entry = pm.getUserPresence("session-1", "user-1");
    expect(entry?.typing).toBe("idle");
  });

  it("clears typing manually", () => {
    pm.setOnline("session-1", "user-1");
    pm.setTyping("session-1", "user-1");
    pm.clearTyping("session-1", "user-1");
    expect(pm.getUserPresence("session-1", "user-1")?.typing).toBe("idle");
  });

  it("tracks multiple users in a session", () => {
    pm.setOnline("session-1", "user-1");
    pm.setOnline("session-1", "user-2");
    pm.setOnline("session-1", "user-3");
    expect(pm.getSessionPresence("session-1")).toHaveLength(3);
  });

  it("isolates sessions", () => {
    pm.setOnline("session-1", "user-1");
    pm.setOnline("session-2", "user-2");
    expect(pm.getSessionPresence("session-1")).toHaveLength(1);
    expect(pm.getSessionPresence("session-2")).toHaveLength(1);
  });

  it("clears session data", () => {
    pm.setOnline("session-1", "user-1");
    pm.setOnline("session-1", "user-2");
    pm.clearSession("session-1");
    expect(pm.getSessionPresence("session-1")).toHaveLength(0);
  });

  it("broadcasts presence updates", () => {
    const updates: unknown[] = [];
    pm.setBroadcaster((_sessionId, update) => updates.push(update));

    pm.setOnline("session-1", "user-1");
    expect(updates).toHaveLength(1);

    pm.setTyping("session-1", "user-1");
    expect(updates).toHaveLength(2);
  });

  it("returns empty for unknown sessions", () => {
    expect(pm.getSessionPresence("unknown")).toEqual([]);
    expect(pm.getUserPresence("unknown", "user")).toBeNull();
  });
});
