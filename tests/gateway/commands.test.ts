import { describe, it, expect, beforeEach } from "vitest";
import { handleCommand, getSessionSettings } from "../../gateway/src/commands/handler.js";
import { SessionManager } from "../../gateway/src/session/manager.js";

describe("Chat Commands", () => {
  let sessionManager: SessionManager;
  let sessionId: string;

  beforeEach(() => {
    sessionManager = new SessionManager({ flushIntervalMs: 300_000 });
    const session = sessionManager.createSession("agent-1", "webchat", "user-1");
    sessionId = session.id;
  });

  it("ignores non-command messages", () => {
    const result = handleCommand("Hello world", sessionId, sessionManager);
    expect(result.handled).toBe(false);
    expect(result.consumed).toBe(false);
  });

  it("handles /status", () => {
    const result = handleCommand("/status", sessionId, sessionManager);
    expect(result.handled).toBe(true);
    expect(result.consumed).toBe(true);
    expect(result.response).toContain("Session Status");
    expect(result.response).toContain(sessionId);
  });

  it("handles /reset", () => {
    const result = handleCommand("/reset", sessionId, sessionManager);
    expect(result.handled).toBe(true);
    expect(result.response).toContain("cleared");
  });

  it("handles /new as alias for /reset", () => {
    const result = handleCommand("/new", sessionId, sessionManager);
    expect(result.handled).toBe(true);
    expect(result.response).toContain("cleared");
  });

  it("handles /think with level", () => {
    const result = handleCommand("/think high", sessionId, sessionManager);
    expect(result.handled).toBe(true);
    expect(result.response).toContain("high");
    expect(getSessionSettings(sessionId).thinkingLevel).toBe("high");
  });

  it("handles /think without level (shows current)", () => {
    const result = handleCommand("/think", sessionId, sessionManager);
    expect(result.handled).toBe(true);
    expect(result.response).toContain("medium"); // default
  });

  it("rejects invalid /think level", () => {
    const result = handleCommand("/think super", sessionId, sessionManager);
    expect(result.response).toContain("Invalid");
  });

  it("handles /verbose toggle", () => {
    handleCommand("/verbose on", sessionId, sessionManager);
    expect(getSessionSettings(sessionId).verbose).toBe(true);

    handleCommand("/verbose off", sessionId, sessionManager);
    expect(getSessionSettings(sessionId).verbose).toBe(false);
  });

  it("handles /verbose without arg (toggle)", () => {
    handleCommand("/verbose", sessionId, sessionManager);
    expect(getSessionSettings(sessionId).verbose).toBe(true);
    handleCommand("/verbose", sessionId, sessionManager);
    expect(getSessionSettings(sessionId).verbose).toBe(false);
  });

  it("handles /usage cycling", () => {
    handleCommand("/usage", sessionId, sessionManager);
    expect(getSessionSettings(sessionId).usageDisplay).toBe("tokens");
    handleCommand("/usage", sessionId, sessionManager);
    expect(getSessionSettings(sessionId).usageDisplay).toBe("full");
    handleCommand("/usage", sessionId, sessionManager);
    expect(getSessionSettings(sessionId).usageDisplay).toBe("off");
  });

  it("handles /usage with explicit mode", () => {
    handleCommand("/usage full", sessionId, sessionManager);
    expect(getSessionSettings(sessionId).usageDisplay).toBe("full");
  });

  it("handles /help", () => {
    const result = handleCommand("/help", sessionId, sessionManager);
    expect(result.handled).toBe(true);
    expect(result.response).toContain("Available Commands");
    expect(result.response).toContain("/status");
    expect(result.response).toContain("/think");
  });

  it("handles /compact (passes through to agent)", () => {
    const result = handleCommand("/compact", sessionId, sessionManager);
    expect(result.handled).toBe(true);
    expect(result.consumed).toBe(false); // Agent should handle the actual compaction
  });

  it("returns unhandled for unknown commands", () => {
    const result = handleCommand("/unknown-command", sessionId, sessionManager);
    expect(result.handled).toBe(false);
  });
});
