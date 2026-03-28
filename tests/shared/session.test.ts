import { describe, it, expect } from "vitest";
import {
  SessionSchema,
  SessionStatusSchema,
  ConversationMessageSchema,
  CreateSessionInputSchema,
  ConversationThreadSchema,
} from "../../packages/shared/src/types/session.js";

describe("Session Types", () => {
  describe("SessionStatusSchema", () => {
    it("accepts valid statuses", () => {
      for (const status of ["active", "idle", "suspended", "terminated"]) {
        expect(SessionStatusSchema.safeParse(status).success).toBe(true);
      }
    });

    it("rejects invalid status", () => {
      expect(SessionStatusSchema.safeParse("unknown").success).toBe(false);
    });
  });

  describe("SessionSchema", () => {
    it("validates a complete session", () => {
      const session = {
        id: "session-1",
        channelType: "webchat",
        channelId: "agent-1",
        userId: "user-1",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        metadata: {},
        stats: {
          messageCount: 5,
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          totalCostUsd: 0.01,
        },
      };
      const result = SessionSchema.safeParse(session);
      expect(result.success).toBe(true);
    });

    it("validates a minimal session", () => {
      const session = {
        id: "session-2",
        channelType: "telegram",
        channelId: "agent-2",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const result = SessionSchema.safeParse(session);
      expect(result.success).toBe(true);
    });

    it("rejects missing required fields", () => {
      const session = { id: "session-3" };
      const result = SessionSchema.safeParse(session);
      expect(result.success).toBe(false);
    });
  });

  describe("ConversationMessageSchema", () => {
    it("validates user message", () => {
      const msg = {
        id: "msg-1",
        sessionId: "session-1",
        role: "user",
        content: "Hello!",
        timestamp: Date.now(),
      };
      expect(ConversationMessageSchema.safeParse(msg).success).toBe(true);
    });

    it("validates assistant message with metadata", () => {
      const msg = {
        id: "msg-2",
        sessionId: "session-1",
        role: "assistant",
        content: "Hi there!",
        timestamp: Date.now(),
        metadata: {
          model: "claude-sonnet-4-20250514",
          inputTokens: 50,
          outputTokens: 20,
          latencyMs: 1200,
        },
      };
      expect(ConversationMessageSchema.safeParse(msg).success).toBe(true);
    });

    it("validates tool message", () => {
      const msg = {
        id: "msg-3",
        sessionId: "session-1",
        role: "tool",
        content: '{"result": "success"}',
        timestamp: Date.now(),
        metadata: {
          toolCallId: "tc-1",
          toolName: "web_search",
        },
      };
      expect(ConversationMessageSchema.safeParse(msg).success).toBe(true);
    });
  });

  describe("CreateSessionInputSchema", () => {
    it("validates creation input", () => {
      const input = {
        channelType: "webchat",
        channelId: "agent-1",
        userId: "user-1",
        context: {
          model: "claude-sonnet-4-20250514",
          maxTokens: 4096,
        },
      };
      expect(CreateSessionInputSchema.safeParse(input).success).toBe(true);
    });
  });
});
