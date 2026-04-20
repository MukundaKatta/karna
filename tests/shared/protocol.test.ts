import { describe, it, expect } from "vitest";
import {
  ProtocolMessageSchema,
  ConnectMessageSchema,
  ChatMessageSchema,
  AgentResponseMessageSchema,
  ToolApprovalRequestedMessageSchema,
  StatusMessageSchema,
  ErrorMessageSchema,
  parseProtocolMessage,
  safeParseProtocolMessage,
  RTCOfferMessageSchema,
} from "../../packages/shared/src/types/protocol.js";

describe("Protocol Schema", () => {
  describe("ConnectMessage", () => {
    it("validates a well-formed connect message", () => {
      const msg = {
        id: "msg-1",
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "webchat",
          channelId: "agent-001",
        },
      };
      const result = ConnectMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects missing channelType", () => {
      const msg = {
        id: "msg-1",
        type: "connect",
        timestamp: Date.now(),
        payload: { channelId: "agent-001" },
      };
      const result = ConnectMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("allows optional metadata", () => {
      const msg = {
        id: "msg-1",
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "telegram",
          channelId: "agent-002",
          metadata: { token: "abc", userId: "user-1" },
        },
      };
      const result = ConnectMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("RTCOfferMessage", () => {
    it("validates a WebRTC offer message", () => {
      const msg = {
        id: "msg-rtc-offer",
        type: "rtc.offer",
        timestamp: Date.now(),
        sessionId: "session-1",
        payload: {
          targetChannelId: "mobile-1",
          description: {
            type: "offer",
            sdp: "v=0\r\no=- 46117326 2 IN IP4 127.0.0.1",
          },
        },
      };
      const result = RTCOfferMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("ChatMessage", () => {
    it("validates a user chat message", () => {
      const msg = {
        id: "msg-2",
        type: "chat.message",
        timestamp: Date.now(),
        sessionId: "session-1",
        payload: {
          content: "Hello Karna!",
          role: "user",
        },
      };
      const result = ChatMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("rejects empty content", () => {
      const msg = {
        id: "msg-2",
        type: "chat.message",
        timestamp: Date.now(),
        payload: { content: "", role: "user" },
      };
      const result = ChatMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("validates with attachments", () => {
      const msg = {
        id: "msg-3",
        type: "chat.message",
        timestamp: Date.now(),
        sessionId: "session-1",
        payload: {
          content: "Check this file",
          role: "user",
          attachments: [
            { type: "image", name: "photo.png" },
          ],
        },
      };
      const result = ChatMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("AgentResponseMessage", () => {
    it("validates agent response with usage", () => {
      const msg = {
        id: "msg-4",
        type: "agent.response",
        timestamp: Date.now(),
        sessionId: "session-1",
        payload: {
          content: "Hello! How can I help?",
          role: "assistant",
          finishReason: "stop",
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      };
      const result = AgentResponseMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("StatusMessage", () => {
    it("validates all state values", () => {
      for (const state of ["idle", "thinking", "tool_calling", "streaming", "error"]) {
        const msg = {
          id: "msg-5",
          type: "status",
          timestamp: Date.now(),
          sessionId: "session-1",
          payload: { state },
        };
        const result = StatusMessageSchema.safeParse(msg);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("ErrorMessage", () => {
    it("validates error with retryable flag", () => {
      const msg = {
        id: "msg-6",
        type: "error",
        timestamp: Date.now(),
        payload: {
          code: "RATE_LIMIT",
          message: "Too many requests",
          retryable: true,
        },
      };
      const result = ErrorMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  describe("ProtocolMessage (discriminated union)", () => {
    it("routes to correct schema by type", () => {
      const connectMsg = {
        id: "msg-1",
        type: "connect",
        timestamp: Date.now(),
        payload: { channelType: "webchat", channelId: "agent-1" },
      };
      const result = ProtocolMessageSchema.safeParse(connectMsg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("connect");
      }
    });

    it("rejects unknown message types", () => {
      const msg = {
        id: "msg-1",
        type: "unknown.type",
        timestamp: Date.now(),
        payload: {},
      };
      const result = ProtocolMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  describe("parseProtocolMessage", () => {
    it("parses valid message", () => {
      const msg = {
        id: "msg-1",
        type: "status",
        timestamp: Date.now(),
        payload: { state: "idle" },
      };
      expect(() => parseProtocolMessage(msg)).not.toThrow();
    });

    it("throws on invalid message", () => {
      expect(() => parseProtocolMessage({ invalid: true })).toThrow();
    });
  });

  describe("safeParseProtocolMessage", () => {
    it("returns success for valid messages", () => {
      const msg = {
        id: "msg-1",
        type: "error",
        timestamp: Date.now(),
        payload: { code: "TEST", message: "Test error" },
      };
      const result = safeParseProtocolMessage(msg);
      expect(result.success).toBe(true);
    });

    it("returns failure for invalid messages", () => {
      const result = safeParseProtocolMessage({ bad: "data" });
      expect(result.success).toBe(false);
    });
  });
});
