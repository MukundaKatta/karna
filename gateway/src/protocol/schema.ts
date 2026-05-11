import pino from "pino";
import {
  ProtocolMessageSchema,
  type ProtocolMessage,
} from "@karna/shared/types/protocol.js";
import type { z } from "zod";

const logger = pino({ name: "protocol-schema" });

export interface ParseMessageSuccess {
  ok: true;
  message: ProtocolMessage;
}

export interface ParseMessageFailure {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
  formErrors?: string[];
  rawType?: unknown;
}

export type ParseMessageResult = ParseMessageSuccess | ParseMessageFailure;

// Re-export all protocol schemas and types from the shared package
// for convenient access within the gateway codebase.
export {
  MessageTypeSchema,
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
  ProtocolMessageSchema,
  parseProtocolMessage,
  safeParseProtocolMessage,
} from "@karna/shared/types/protocol.js";

export type {
  MessageType,
  ConnectMessage,
  ConnectChallengeMessage,
  ConnectAckMessage,
  ChatMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  ToolApprovalRequestedMessage,
  ToolApprovalResponseMessage,
  ToolResultMessage,
  HeartbeatCheckMessage,
  HeartbeatAckMessage,
  StatusMessage,
  SkillInvokeMessage,
  SkillResultMessage,
  VoiceStartMessage,
  VoiceAudioChunkMessage,
  VoiceAudioResponseMessage,
  VoiceTranscriptMessage,
  VoiceEndMessage,
  RTCOfferMessage,
  RTCAnswerMessage,
  RTCIceCandidateMessage,
  RTCHangupMessage,
  AgentHandoffMessage,
  OrchestrationStatusMessage,
  ErrorMessage,
  ProtocolMessage,
} from "@karna/shared/types/protocol.js";

/**
 * Parse an incoming WebSocket data payload (string or Buffer) into
 * a validated ProtocolMessage.
 *
 * Returns the parsed message on success, or null on failure (with structured logging).
 */
export function parseMessage(data: string | Buffer): ProtocolMessage | null {
  const result = parseMessageDetailed(data);
  return result.ok ? result.message : null;
}

export function parseMessageDetailed(data: string | Buffer): ParseMessageResult {
  let parsed: unknown;

  try {
    const raw = typeof data === "string" ? data : data.toString("utf-8");
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.warn({ error: String(error) }, "Failed to parse WebSocket message as JSON");
    return {
      ok: false,
      error: "Message must be valid JSON.",
      formErrors: [String(error)],
    };
  }

  const result = ProtocolMessageSchema.safeParse(parsed);

  if (!result.success) {
    const flattened = result.error.flatten() as z.typeToFlattenedError<unknown>;
    const rawType = (parsed as Record<string, unknown>)?.["type"];
    logger.warn(
      { errors: flattened, rawType },
      "WebSocket message failed schema validation"
    );
    return {
      ok: false,
      error: "Message failed protocol schema validation.",
      fieldErrors: flattened.fieldErrors,
      formErrors: flattened.formErrors,
      rawType,
    };
  }

  return { ok: true, message: result.data };
}
