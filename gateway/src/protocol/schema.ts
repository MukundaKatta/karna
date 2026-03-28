import pino from "pino";
import {
  ProtocolMessageSchema,
  type ProtocolMessage,
} from "@karna/shared/types/protocol.js";

const logger = pino({ name: "protocol-schema" });

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
  let parsed: unknown;

  try {
    const raw = typeof data === "string" ? data : data.toString("utf-8");
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.warn({ error: String(error) }, "Failed to parse WebSocket message as JSON");
    return null;
  }

  const result = ProtocolMessageSchema.safeParse(parsed);

  if (!result.success) {
    logger.warn(
      { errors: result.error.flatten(), rawType: (parsed as Record<string, unknown>)?.["type"] },
      "WebSocket message failed schema validation"
    );
    return null;
  }

  return result.data;
}
