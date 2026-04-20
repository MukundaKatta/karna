import { describe, it, expect } from "vitest";
import {
  ConnectMessageSchema,
  ChatMessageSchema,
  AgentResponseStreamMessageSchema,
  ToolApprovalRequestedMessageSchema,
  ToolApprovalResponseMessageSchema,
  ToolResultMessageSchema,
  VoiceAudioChunkMessageSchema,
  RTCIceCandidateMessageSchema,
  HeartbeatCheckMessageSchema,
  HeartbeatAckMessageSchema,
  SkillInvokeMessageSchema,
  SkillResultMessageSchema,
  ErrorMessageSchema,
  MessageTypeSchema,
} from "../../packages/shared/src/types/protocol.js";

describe("Protocol Schema - Extended Coverage", () => {
  describe("MessageTypeSchema", () => {
    const validTypes = [
      "connect", "connect.challenge", "connect.ack",
      "chat.message", "agent.response", "agent.response.stream",
      "tool.approval.requested", "tool.approval.response", "tool.result",
      "heartbeat.check", "heartbeat.ack",
      "status", "skill.invoke", "skill.result", "error",
      "rtc.offer", "rtc.answer", "rtc.ice-candidate", "rtc.hangup",
    ];

    for (const type of validTypes) {
      it(`accepts "${type}"`, () => {
        expect(MessageTypeSchema.safeParse(type).success).toBe(true);
      });
    }

    it("rejects unknown types", () => {
      expect(MessageTypeSchema.safeParse("unknown").success).toBe(false);
      expect(MessageTypeSchema.safeParse("").success).toBe(false);
    });
  });

  describe("AgentResponseStreamMessage", () => {
    it("validates a stream delta", () => {
      const msg = {
        id: "msg-1",
        type: "agent.response.stream",
        timestamp: Date.now(),
        sessionId: "session-1",
        payload: { delta: "Hello", index: 0, finishReason: null },
      };
      expect(AgentResponseStreamMessageSchema.safeParse(msg).success).toBe(true);
    });

    it("allows finishReason to be stop", () => {
      const msg = {
        id: "msg-1",
        type: "agent.response.stream",
        timestamp: Date.now(),
        payload: { delta: "", index: 5, finishReason: "stop" },
      };
      expect(AgentResponseStreamMessageSchema.safeParse(msg).success).toBe(true);
    });
  });

  describe("ToolApprovalRequestedMessage", () => {
    it("validates all risk levels", () => {
      for (const riskLevel of ["low", "medium", "high", "critical"]) {
        const msg = {
          id: "msg-1",
          type: "tool.approval.requested",
          timestamp: Date.now(),
          sessionId: "session-1",
          payload: {
            toolCallId: "tc-1",
            toolName: "shell_exec",
            arguments: { command: "ls" },
            riskLevel,
          },
        };
        expect(ToolApprovalRequestedMessageSchema.safeParse(msg).success).toBe(true);
      }
    });
  });

  describe("VoiceAudioChunkMessage", () => {
    it("accepts mobile m4a audio chunks", () => {
      const msg = {
        id: "msg-voice-1",
        type: "voice.audio.chunk",
        timestamp: Date.now(),
        sessionId: "session-1",
        payload: {
          data: "YmFzZTY0",
          format: "m4a",
          sampleRate: 44100,
        },
      };

      expect(VoiceAudioChunkMessageSchema.safeParse(msg).success).toBe(true);
    });
  });

  describe("RTCIceCandidateMessage", () => {
    it("accepts an ICE candidate relay payload", () => {
      const msg = {
        id: "msg-rtc-ice-1",
        type: "rtc.ice-candidate",
        timestamp: Date.now(),
        sessionId: "session-1",
        payload: {
          targetChannelId: "web-peer",
          candidate: {
            candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 54400 typ host",
            sdpMid: "0",
            sdpMLineIndex: 0,
          },
        },
      };

      expect(RTCIceCandidateMessageSchema.safeParse(msg).success).toBe(true);
    });
  });

  describe("ToolApprovalResponseMessage", () => {
    it("validates approved response", () => {
      const msg = {
        id: "msg-1",
        type: "tool.approval.response",
        timestamp: Date.now(),
        sessionId: "session-1",
        payload: { toolCallId: "tc-1", approved: true },
      };
      expect(ToolApprovalResponseMessageSchema.safeParse(msg).success).toBe(true);
    });

    it("validates rejected response with reason", () => {
      const msg = {
        id: "msg-1",
        type: "tool.approval.response",
        timestamp: Date.now(),
        payload: { toolCallId: "tc-1", approved: false, reason: "Too risky" },
      };
      expect(ToolApprovalResponseMessageSchema.safeParse(msg).success).toBe(true);
    });
  });

  describe("ToolResultMessage", () => {
    it("validates a successful tool result", () => {
      const msg = {
        id: "msg-1",
        type: "tool.result",
        timestamp: Date.now(),
        payload: {
          toolCallId: "tc-1",
          toolName: "web_search",
          result: { data: [1, 2, 3] },
          isError: false,
          durationMs: 250,
        },
      };
      expect(ToolResultMessageSchema.safeParse(msg).success).toBe(true);
    });

    it("validates an error tool result", () => {
      const msg = {
        id: "msg-1",
        type: "tool.result",
        timestamp: Date.now(),
        payload: {
          toolCallId: "tc-1",
          toolName: "shell_exec",
          result: "Permission denied",
          isError: true,
        },
      };
      expect(ToolResultMessageSchema.safeParse(msg).success).toBe(true);
    });
  });

  describe("HeartbeatMessages", () => {
    it("validates heartbeat check", () => {
      const msg = {
        id: "msg-1",
        type: "heartbeat.check",
        timestamp: Date.now(),
        payload: { serverTime: Date.now() },
      };
      expect(HeartbeatCheckMessageSchema.safeParse(msg).success).toBe(true);
    });

    it("validates heartbeat ack", () => {
      const msg = {
        id: "msg-1",
        type: "heartbeat.ack",
        timestamp: Date.now(),
        payload: { clientTime: Date.now() },
      };
      expect(HeartbeatAckMessageSchema.safeParse(msg).success).toBe(true);
    });
  });

  describe("SkillMessages", () => {
    it("validates skill invoke", () => {
      const msg = {
        id: "msg-1",
        type: "skill.invoke",
        timestamp: Date.now(),
        sessionId: "session-1",
        payload: {
          skillId: "news-digest",
          action: "fetch",
          parameters: { topic: "AI" },
        },
      };
      expect(SkillInvokeMessageSchema.safeParse(msg).success).toBe(true);
    });

    it("validates skill result", () => {
      const msg = {
        id: "msg-1",
        type: "skill.result",
        timestamp: Date.now(),
        sessionId: "session-1",
        payload: {
          skillId: "code-reviewer",
          action: "review",
          result: { grade: "A", findings: [] },
          isError: false,
        },
      };
      expect(SkillResultMessageSchema.safeParse(msg).success).toBe(true);
    });

    it("skill invoke without parameters is valid", () => {
      const msg = {
        id: "msg-1",
        type: "skill.invoke",
        timestamp: Date.now(),
        payload: { skillId: "daily-briefing", action: "generate" },
      };
      expect(SkillInvokeMessageSchema.safeParse(msg).success).toBe(true);
    });
  });

  describe("ErrorMessage", () => {
    it("validates error with details", () => {
      const msg = {
        id: "msg-1",
        type: "error",
        timestamp: Date.now(),
        payload: {
          code: "VALIDATION_ERROR",
          message: "Invalid input",
          details: { field: "content", expected: "string" },
          retryable: false,
        },
      };
      expect(ErrorMessageSchema.safeParse(msg).success).toBe(true);
    });

    it("rejects empty error code", () => {
      const msg = {
        id: "msg-1",
        type: "error",
        timestamp: Date.now(),
        payload: { code: "", message: "Error" },
      };
      expect(ErrorMessageSchema.safeParse(msg).success).toBe(false);
    });

    it("rejects empty error message", () => {
      const msg = {
        id: "msg-1",
        type: "error",
        timestamp: Date.now(),
        payload: { code: "ERR", message: "" },
      };
      expect(ErrorMessageSchema.safeParse(msg).success).toBe(false);
    });
  });

  describe("Base message validation", () => {
    it("rejects message without id", () => {
      const msg = {
        type: "error",
        timestamp: Date.now(),
        payload: { code: "ERR", message: "test" },
      };
      expect(ErrorMessageSchema.safeParse(msg).success).toBe(false);
    });

    it("rejects message with empty id", () => {
      const msg = {
        id: "",
        type: "error",
        timestamp: Date.now(),
        payload: { code: "ERR", message: "test" },
      };
      expect(ErrorMessageSchema.safeParse(msg).success).toBe(false);
    });

    it("rejects message without timestamp", () => {
      const msg = {
        id: "msg-1",
        type: "error",
        payload: { code: "ERR", message: "test" },
      };
      expect(ErrorMessageSchema.safeParse(msg).success).toBe(false);
    });

    it("rejects negative timestamp", () => {
      const msg = {
        id: "msg-1",
        type: "error",
        timestamp: -1,
        payload: { code: "ERR", message: "test" },
      };
      expect(ErrorMessageSchema.safeParse(msg).success).toBe(false);
    });
  });
});
