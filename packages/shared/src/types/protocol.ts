import { z } from "zod";

// ─── Base Message Schema ─────────────────────────────────────────────────────

export const MessageTypeSchema = z.enum([
  "connect",
  "connect.challenge",
  "connect.ack",
  "chat.message",
  "agent.response",
  "agent.response.stream",
  "tool.approval.requested",
  "tool.approval.response",
  "tool.result",
  "heartbeat.check",
  "heartbeat.ack",
  "status",
  "skill.invoke",
  "skill.result",
  "voice.start",
  "voice.audio.chunk",
  "voice.audio.response",
  "voice.transcript",
  "voice.end",
  "rtc.offer",
  "rtc.answer",
  "rtc.ice-candidate",
  "rtc.hangup",
  "agent.handoff",
  "orchestration.status",
  "error",
]);

export type MessageType = z.infer<typeof MessageTypeSchema>;

const BaseMessageSchema = z.object({
  id: z.string().min(1),
  type: MessageTypeSchema,
  timestamp: z.number().int().positive(),
  sessionId: z.string().min(1).optional(),
});

// ─── Connect Messages ────────────────────────────────────────────────────────

export const ConnectMessageSchema = BaseMessageSchema.extend({
  type: z.literal("connect"),
  payload: z.object({
    channelType: z.string().min(1),
    channelId: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  }),
});

export const ConnectChallengeMessageSchema = BaseMessageSchema.extend({
  type: z.literal("connect.challenge"),
  payload: z.object({
    challenge: z.string().min(1),
    expiresAt: z.number().int().positive(),
  }),
});

export const ConnectAckMessageSchema = BaseMessageSchema.extend({
  type: z.literal("connect.ack"),
  payload: z.object({
    sessionId: z.string().min(1),
    channelId: z.string().min(1),
    token: z.string().min(1),
    expiresAt: z.number().int().positive(),
  }),
});

// ─── Chat Messages ───────────────────────────────────────────────────────────

export const ChatMessageSchema = BaseMessageSchema.extend({
  type: z.literal("chat.message"),
  payload: z.object({
    content: z.string().min(1),
    role: z.enum(["user", "assistant", "system"]),
    attachments: z
      .array(
        z.object({
          type: z.string().min(1),
          url: z.string().url().optional(),
          data: z.string().optional(),
          name: z.string().optional(),
        })
      )
      .optional(),
  }),
});

// ─── Agent Response Messages ─────────────────────────────────────────────────

export const AgentResponseMessageSchema = BaseMessageSchema.extend({
  type: z.literal("agent.response"),
  payload: z.object({
    content: z.string(),
    role: z.literal("assistant"),
    finishReason: z.enum(["stop", "tool_use", "max_tokens", "error"]),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        cacheReadTokens: z.number().int().nonnegative().optional(),
        cacheWriteTokens: z.number().int().nonnegative().optional(),
      })
      .optional(),
  }),
});

export const AgentResponseStreamMessageSchema = BaseMessageSchema.extend({
  type: z.literal("agent.response.stream"),
  payload: z.object({
    delta: z.string(),
    index: z.number().int().nonnegative(),
    finishReason: z.enum(["stop", "tool_use", "max_tokens", "error"]).nullable(),
  }),
});

// ─── Tool Messages ───────────────────────────────────────────────────────────

export const ToolApprovalRequestedMessageSchema = BaseMessageSchema.extend({
  type: z.literal("tool.approval.requested"),
  payload: z.object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    arguments: z.record(z.unknown()),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    description: z.string().optional(),
  }),
});

export const ToolApprovalResponseMessageSchema = BaseMessageSchema.extend({
  type: z.literal("tool.approval.response"),
  payload: z.object({
    toolCallId: z.string().min(1),
    approved: z.boolean(),
    reason: z.string().optional(),
  }),
});

export const ToolResultMessageSchema = BaseMessageSchema.extend({
  type: z.literal("tool.result"),
  payload: z.object({
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    result: z.unknown(),
    isError: z.boolean().default(false),
    durationMs: z.number().int().nonnegative().optional(),
  }),
});

// ─── Heartbeat Messages ─────────────────────────────────────────────────────

export const HeartbeatCheckMessageSchema = BaseMessageSchema.extend({
  type: z.literal("heartbeat.check"),
  payload: z.object({
    serverTime: z.number().int().positive(),
  }),
});

export const HeartbeatAckMessageSchema = BaseMessageSchema.extend({
  type: z.literal("heartbeat.ack"),
  payload: z.object({
    clientTime: z.number().int().positive(),
  }),
});

// ─── Status Messages ─────────────────────────────────────────────────────────

export const StatusMessageSchema = BaseMessageSchema.extend({
  type: z.literal("status"),
  payload: z.object({
    state: z.enum(["idle", "thinking", "tool_calling", "streaming", "error"]),
    message: z.string().optional(),
    progress: z.number().min(0).max(1).optional(),
  }),
});

// ─── Skill Messages ──────────────────────────────────────────────────────────

export const SkillInvokeMessageSchema = BaseMessageSchema.extend({
  type: z.literal("skill.invoke"),
  payload: z.object({
    skillId: z.string().min(1),
    action: z.string().min(1),
    parameters: z.record(z.unknown()).optional(),
  }),
});

export const SkillResultMessageSchema = BaseMessageSchema.extend({
  type: z.literal("skill.result"),
  payload: z.object({
    skillId: z.string().min(1),
    action: z.string().min(1),
    result: z.unknown(),
    isError: z.boolean().default(false),
  }),
});

// ─── Voice Messages ─────────────────────────────────────────────────────────

export const VoiceStartMessageSchema = BaseMessageSchema.extend({
  type: z.literal("voice.start"),
  payload: z.object({
    mode: z.enum(["push-to-talk", "continuous"]),
  }),
});

export const VoiceAudioChunkMessageSchema = BaseMessageSchema.extend({
  type: z.literal("voice.audio.chunk"),
  payload: z.object({
    data: z.string().min(1),
    format: z.enum(["webm", "wav", "m4a"]),
    sampleRate: z.number().int().positive(),
  }),
});

export const VoiceAudioResponseMessageSchema = BaseMessageSchema.extend({
  type: z.literal("voice.audio.response"),
  payload: z.object({
    data: z.string().min(1),
    format: z.enum(["mp3", "wav"]),
    transcript: z.string(),
  }),
});

export const VoiceTranscriptMessageSchema = BaseMessageSchema.extend({
  type: z.literal("voice.transcript"),
  payload: z.object({
    text: z.string(),
    isFinal: z.boolean(),
  }),
});

export const VoiceEndMessageSchema = BaseMessageSchema.extend({
  type: z.literal("voice.end"),
  payload: z.object({}).optional(),
});

// ─── WebRTC Signaling Messages ──────────────────────────────────────────────

const RTCSessionDescriptionSchema = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().min(1),
});

const RTCIceCandidateSchema = z.object({
  candidate: z.string().min(1),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().int().nonnegative().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});

const RTCSignalPayloadBaseSchema = z.object({
  targetChannelId: z.string().min(1),
  sourceChannelId: z.string().min(1).optional(),
});

export const RTCOfferMessageSchema = BaseMessageSchema.extend({
  type: z.literal("rtc.offer"),
  payload: RTCSignalPayloadBaseSchema.extend({
    description: RTCSessionDescriptionSchema.extend({
      type: z.literal("offer"),
    }),
  }),
});

export const RTCAnswerMessageSchema = BaseMessageSchema.extend({
  type: z.literal("rtc.answer"),
  payload: RTCSignalPayloadBaseSchema.extend({
    description: RTCSessionDescriptionSchema.extend({
      type: z.literal("answer"),
    }),
  }),
});

export const RTCIceCandidateMessageSchema = BaseMessageSchema.extend({
  type: z.literal("rtc.ice-candidate"),
  payload: RTCSignalPayloadBaseSchema.extend({
    candidate: RTCIceCandidateSchema,
  }),
});

export const RTCHangupMessageSchema = BaseMessageSchema.extend({
  type: z.literal("rtc.hangup"),
  payload: RTCSignalPayloadBaseSchema.extend({
    reason: z.string().min(1).optional(),
  }),
});

// ─── Agent Handoff Messages ──────────────────────────────────────────────────

export const AgentHandoffMessageSchema = BaseMessageSchema.extend({
  type: z.literal("agent.handoff"),
  payload: z.object({
    fromAgentId: z.string().min(1),
    toAgentId: z.string().min(1),
    reason: z.string().min(1),
    contextSummary: z.string().optional(),
  }),
});

// ─── Orchestration Status Messages ──────────────────────────────────────────

export const OrchestrationStatusMessageSchema = BaseMessageSchema.extend({
  type: z.literal("orchestration.status"),
  payload: z.object({
    activeAgents: z.number().int().nonnegative(),
    delegations: z.array(
      z.object({
        fromAgentId: z.string(),
        toAgentId: z.string(),
        reason: z.string(),
        task: z.string(),
        timestamp: z.number().int().positive(),
      })
    ),
  }),
});

// ─── Error Message ───────────────────────────────────────────────────────────

export const ErrorMessageSchema = BaseMessageSchema.extend({
  type: z.literal("error"),
  payload: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.unknown()).optional(),
    retryable: z.boolean().default(false),
  }),
});

// ─── Discriminated Union ─────────────────────────────────────────────────────

export const ProtocolMessageSchema = z.discriminatedUnion("type", [
  ConnectMessageSchema,
  ConnectChallengeMessageSchema,
  ConnectAckMessageSchema,
  ChatMessageSchema,
  AgentResponseMessageSchema,
  AgentResponseStreamMessageSchema,
  ToolApprovalRequestedMessageSchema,
  ToolApprovalResponseMessageSchema,
  ToolResultMessageSchema,
  HeartbeatCheckMessageSchema,
  HeartbeatAckMessageSchema,
  StatusMessageSchema,
  SkillInvokeMessageSchema,
  SkillResultMessageSchema,
  VoiceStartMessageSchema,
  VoiceAudioChunkMessageSchema,
  VoiceAudioResponseMessageSchema,
  VoiceTranscriptMessageSchema,
  VoiceEndMessageSchema,
  RTCOfferMessageSchema,
  RTCAnswerMessageSchema,
  RTCIceCandidateMessageSchema,
  RTCHangupMessageSchema,
  AgentHandoffMessageSchema,
  OrchestrationStatusMessageSchema,
  ErrorMessageSchema,
]);

// ─── Inferred Types ──────────────────────────────────────────────────────────

export type ConnectMessage = z.infer<typeof ConnectMessageSchema>;
export type ConnectChallengeMessage = z.infer<typeof ConnectChallengeMessageSchema>;
export type ConnectAckMessage = z.infer<typeof ConnectAckMessageSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type AgentResponseMessage = z.infer<typeof AgentResponseMessageSchema>;
export type AgentResponseStreamMessage = z.infer<typeof AgentResponseStreamMessageSchema>;
export type ToolApprovalRequestedMessage = z.infer<typeof ToolApprovalRequestedMessageSchema>;
export type ToolApprovalResponseMessage = z.infer<typeof ToolApprovalResponseMessageSchema>;
export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>;
export type HeartbeatCheckMessage = z.infer<typeof HeartbeatCheckMessageSchema>;
export type HeartbeatAckMessage = z.infer<typeof HeartbeatAckMessageSchema>;
export type StatusMessage = z.infer<typeof StatusMessageSchema>;
export type SkillInvokeMessage = z.infer<typeof SkillInvokeMessageSchema>;
export type SkillResultMessage = z.infer<typeof SkillResultMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type VoiceStartMessage = z.infer<typeof VoiceStartMessageSchema>;
export type VoiceAudioChunkMessage = z.infer<typeof VoiceAudioChunkMessageSchema>;
export type VoiceAudioResponseMessage = z.infer<typeof VoiceAudioResponseMessageSchema>;
export type VoiceTranscriptMessage = z.infer<typeof VoiceTranscriptMessageSchema>;
export type VoiceEndMessage = z.infer<typeof VoiceEndMessageSchema>;
export type RTCOfferMessage = z.infer<typeof RTCOfferMessageSchema>;
export type RTCAnswerMessage = z.infer<typeof RTCAnswerMessageSchema>;
export type RTCIceCandidateMessage = z.infer<typeof RTCIceCandidateMessageSchema>;
export type RTCHangupMessage = z.infer<typeof RTCHangupMessageSchema>;
export type AgentHandoffMessage = z.infer<typeof AgentHandoffMessageSchema>;
export type OrchestrationStatusMessage = z.infer<typeof OrchestrationStatusMessageSchema>;
export type ProtocolMessage = z.infer<typeof ProtocolMessageSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse and validate a raw WebSocket message payload.
 * Returns the validated ProtocolMessage or throws a ZodError.
 */
export function parseProtocolMessage(data: unknown): ProtocolMessage {
  return ProtocolMessageSchema.parse(data);
}

/**
 * Safely parse a protocol message, returning a result object instead of throwing.
 */
export function safeParseProtocolMessage(
  data: unknown
): z.SafeParseReturnType<unknown, ProtocolMessage> {
  return ProtocolMessageSchema.safeParse(data);
}
