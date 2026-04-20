import type { WebSocket } from "@fastify/websocket";
import { nanoid } from "nanoid";
import pino from "pino";
import type {
  ProtocolMessage,
  ConnectMessage,
  ChatMessage,
  SkillInvokeMessage,
  VoiceStartMessage,
  VoiceAudioChunkMessage,
  VoiceEndMessage,
  RTCOfferMessage,
  RTCAnswerMessage,
  RTCIceCandidateMessage,
  RTCHangupMessage,
} from "./schema.js";
import type { AuthContext } from "./auth.js";
import { validateToken, generateChallenge, verifyChallenge, createAuthContext } from "./auth.js";
import type { SessionManager } from "../session/manager.js";
import type { HeartbeatScheduler } from "../heartbeat/scheduler.js";
import type { StreamCallback } from "@karna/agent/runtime.js";
import { handleVoiceStart, handleVoiceAudioChunk, handleVoiceEnd } from "../voice/handler.js";
import { appendToTranscript, readTranscript } from "../session/store.js";
import { Orchestrator } from "@karna/agent/orchestration/orchestrator.js";
import type { AgentDefinition, DelegationRecord } from "@karna/shared/types/orchestration.js";
import type { Session } from "@karna/shared/types/session.js";

const logger = pino({ name: "message-handler" });

// ─── Orchestrator Singleton ──────────────────────────────────────────────────

/**
 * Default agent definitions for the Karna platform.
 * In production these would come from configuration / database.
 */
const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    id: "karna-general",
    name: "Karna",
    description: "A loyal and capable AI assistant. Handles general-purpose tasks, conversation, and coordination.",
    persona: "Helpful, accurate, and concise.",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    specializations: ["general", "conversation", "coordination"],
  },
  {
    id: "karna-coder",
    name: "Karna Coder",
    description: "Specialized in writing, reviewing, and debugging code across multiple languages and frameworks.",
    persona: "Precise, methodical, and thorough when working with code.",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    specializations: ["code", "programming", "debugging", "review"],
  },
  {
    id: "karna-researcher",
    name: "Karna Researcher",
    description: "Specialized in research, analysis, web search, and synthesizing information from multiple sources.",
    persona: "Thorough, analytical, and detail-oriented when researching topics.",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    specializations: ["research", "analysis", "web-search", "synthesis"],
    tools: ["web_search", "browser_navigate", "browser_extract_text", "browser_screenshot"],
  },
  {
    id: "karna-writer",
    name: "Karna Writer",
    description: "Specialized in creative writing, content creation, editing, and document drafting.",
    persona: "Creative, articulate, and adaptable to different writing styles and tones.",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    specializations: ["writing", "content", "editing", "documents"],
  },
];

interface OrchestratorLike {
  activeAgentCount: number;
  init(): Promise<void>;
  setStreamCallback(callback: StreamCallback): void;
  setApprovalCallback(
    callback: (request: { toolCallId: string }) => Promise<{
      toolCallId: string;
      approved: boolean;
      reason?: string;
      respondedAt: number;
    }>,
  ): void;
  setDelegationCallback(callback: (record: DelegationRecord) => void): void;
  handleMessage(
    session: Session,
    content: string,
    history: unknown[],
  ): Promise<{
    success: boolean;
    response: string;
    error?: string;
    totalTokens: { inputTokens: number; outputTokens: number };
    agentId: string;
    delegations: DelegationRecord[];
  }>;
}

let orchestrator: OrchestratorLike | null = null;
let orchestratorFactory: (() => Promise<OrchestratorLike>) | null = null;
const pendingApprovals = new Map<string, { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> }>();

export function setOrchestratorFactoryForTests(factory: (() => Promise<OrchestratorLike>) | null): void {
  orchestratorFactory = factory;
  orchestrator = null;
}

export function resetProtocolTestState(): void {
  for (const pending of pendingApprovals.values()) {
    clearTimeout(pending.timer);
  }
  pendingApprovals.clear();
  orchestrator = null;
  orchestratorFactory = null;
}

async function getOrCreateOrchestrator(): Promise<OrchestratorLike> {
  if (orchestrator) return orchestrator;

  if (orchestratorFactory) {
    orchestrator = await orchestratorFactory();
    return orchestrator;
  }

  orchestrator = new Orchestrator({
    agents: DEFAULT_AGENTS,
    defaultAgentId: "karna-general",
    poolConfig: { maxSize: 10 },
    handoffOptions: { maxDepth: 5 },
    enableSupervisor: false, // Can be enabled when supervisor agent is configured
  });

  await orchestrator.init();
  logger.info("Orchestrator initialized");
  return orchestrator;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ConnectionContext {
  ws: WebSocket;
  auth: AuthContext | null;
  sessionManager: SessionManager;
  heartbeatScheduler: HeartbeatScheduler;
  connectedClients: Map<string, ConnectedClient>;
}

export interface ConnectedClient {
  ws: WebSocket;
  auth: AuthContext | null;
  sessionIds: Set<string>;
  lastSeen: number;
}

// ─── Send Helper ────────────────────────────────────────────────────────────

function sendMessage(ws: WebSocket, message: Record<string, unknown>): void {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  } catch (error) {
    logger.error({ error: String(error) }, "Failed to send WebSocket message");
  }
}

function sendError(ws: WebSocket, code: string, message: string, retryable = false): void {
  sendMessage(ws, {
    id: nanoid(),
    type: "error",
    timestamp: Date.now(),
    payload: { code, message, retryable },
  });
}

// ─── Message Router ─────────────────────────────────────────────────────────

/**
 * Route an incoming validated protocol message to the appropriate handler.
 */
export async function handleMessage(
  ws: WebSocket,
  message: ProtocolMessage,
  context: ConnectionContext,
): Promise<void> {
  logger.debug({ type: message.type, id: message.id }, "Handling message");

  try {
    switch (message.type) {
      case "connect":
        await handleConnect(ws, message, context);
        break;

      case "chat.message":
        await handleChatMessage(ws, message, context);
        break;

      case "tool.approval.response":
        await handleToolApprovalResponse(ws, message, context);
        break;

      case "heartbeat.ack":
        handleHeartbeatAck(ws, message, context);
        break;

      case "skill.invoke":
        await handleSkillInvoke(ws, message, context);
        break;

      case "voice.start":
        handleVoiceStart(ws, (message as VoiceStartMessage).payload, context);
        break;

      case "voice.audio.chunk":
        handleVoiceAudioChunk(ws, (message as VoiceAudioChunkMessage).payload, context);
        break;

      case "voice.end":
        await handleVoiceEnd(ws, (message as VoiceEndMessage).payload, context);
        break;

      case "rtc.offer":
      case "rtc.answer":
      case "rtc.ice-candidate":
      case "rtc.hangup":
        await handleRTCSignal(
          ws,
          message as RTCOfferMessage | RTCAnswerMessage | RTCIceCandidateMessage | RTCHangupMessage,
          context,
        );
        break;

      default:
        logger.warn({ type: message.type }, "Unhandled message type");
        sendError(ws, "UNHANDLED_TYPE", `No handler for message type: ${message.type}`);
    }
  } catch (error) {
    logger.error({ error: String(error), type: message.type }, "Error handling message");
    sendError(ws, "INTERNAL_ERROR", "An internal error occurred while processing the message", true);
  }
}

// ─── Individual Handlers ────────────────────────────────────────────────────

async function handleConnect(
  ws: WebSocket,
  message: ConnectMessage,
  context: ConnectionContext,
): Promise<void> {
  const { channelType, channelId, metadata } = message.payload;
  logger.info({ channelType, channelId }, "Connection request received");

  // Extract token from metadata if provided
  const token = (metadata?.["token"] as string) ?? "";

  if (!validateToken(token)) {
    // Send challenge for authentication
    const challenge = generateChallenge();
    sendMessage(ws, {
      id: nanoid(),
      type: "connect.challenge",
      timestamp: Date.now(),
      payload: {
        challenge: challenge.nonce,
        expiresAt: challenge.expiresAt,
      },
    });
    return;
  }

  // Authenticated — create session and acknowledge
  const auth = createAuthContext(
    channelId,
    (metadata?.["role"] as "operator" | "node") ?? "operator",
    token,
  );

  const session = context.sessionManager.createSession(
    channelId,
    channelType,
    (metadata?.["userId"] as string) ?? undefined,
  );

  // Track the connected client
  const clientId = channelId;
  const existingClient = context.connectedClients.get(clientId);
  if (existingClient) {
    existingClient.ws = ws;
    existingClient.auth = auth;
    existingClient.sessionIds.add(session.id);
    existingClient.lastSeen = Date.now();
  } else {
    context.connectedClients.set(clientId, {
      ws,
      auth,
      sessionIds: new Set([session.id]),
      lastSeen: Date.now(),
    });
  }

  context.auth = auth;

  sendMessage(ws, {
    id: nanoid(),
    type: "connect.ack",
    timestamp: Date.now(),
    payload: {
      sessionId: session.id,
      channelId,
      token: nanoid(32),
      expiresAt: Date.now() + 3_600_000, // 1 hour
    },
  });

  logger.info({ sessionId: session.id, channelType, channelId }, "Connection established");
}

async function handleChatMessage(
  ws: WebSocket,
  message: ChatMessage,
  context: ConnectionContext,
): Promise<void> {
  // Auth gate: require authenticated connection before processing messages
  if (!context.auth) {
    sendError(ws, "UNAUTHENTICATED", "Must send a 'connect' message before chat messages");
    return;
  }

  const { content, role } = message.payload;
  const sessionId = message.sessionId;

  if (!sessionId) {
    sendError(ws, "MISSING_SESSION", "sessionId is required for chat messages");
    return;
  }

  const session = context.sessionManager.getSession(sessionId);
  if (!session) {
    sendError(ws, "SESSION_NOT_FOUND", `Session ${sessionId} not found`);
    return;
  }

  logger.info({ sessionId, role, contentLength: content.length }, "Chat message received");

  // Persist user message to transcript
  await appendToTranscript(sessionId, {
    id: nanoid(),
    sessionId,
    role: "user",
    content,
    timestamp: Date.now(),
  });

  // Send status: thinking
  sendMessage(ws, {
    id: nanoid(),
    type: "status",
    timestamp: Date.now(),
    sessionId,
    payload: {
      state: "thinking",
      message: "Processing your message...",
    },
  });

  // Forward to orchestrator
  try {
    const orch = await getOrCreateOrchestrator();

    // Load conversation history from transcript
    const history = await readTranscript(sessionId, 50);

    // Set up streaming callback to forward deltas to the client
    let streamIndex = 0;
    const streamCallback: StreamCallback = (event) => {
      switch (event.type) {
        case "text":
          sendMessage(ws, {
            id: nanoid(),
            type: "agent.response.stream",
            timestamp: Date.now(),
            sessionId,
            payload: {
              delta: event.text,
              index: streamIndex++,
              finishReason: null,
            },
          });
          break;
        case "tool_use":
          sendMessage(ws, {
            id: nanoid(),
            type: "tool.approval.requested",
            timestamp: Date.now(),
            sessionId,
            payload: {
              toolCallId: event.id,
              toolName: event.name,
              arguments: event.input,
              riskLevel: "medium",
            },
          });
          break;
      }
    };

    orch.setStreamCallback(streamCallback);

    // Set up approval callback to forward requests to the client
    orch.setApprovalCallback(async (request) => {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingApprovals.delete(request.toolCallId);
          resolve({
            toolCallId: request.toolCallId,
            approved: false, // Reject on timeout — never auto-approve
            reason: "Rejected: approval request timed out (60s)",
            respondedAt: Date.now(),
          });
        }, 60_000);

        pendingApprovals.set(request.toolCallId, {
          resolve: (approved: boolean) => {
            resolve({
              toolCallId: request.toolCallId,
              approved,
              respondedAt: Date.now(),
            });
          },
          timer,
        });
      });
    });

    // Set up delegation callback to emit agent.handoff messages to the client
    orch.setDelegationCallback((record: DelegationRecord) => {
      sendMessage(ws, {
        id: nanoid(),
        type: "agent.handoff",
        timestamp: Date.now(),
        sessionId,
        payload: {
          fromAgentId: record.fromAgentId,
          toAgentId: record.toAgentId,
          reason: record.reason,
          contextSummary: record.task,
        },
      });
    });

    // Execute via orchestrator (handles delegation transparently)
    const result = await orch.handleMessage(session, content, history);

    if (result.success) {
      // Send final response
      sendMessage(ws, {
        id: nanoid(),
        type: "agent.response",
        timestamp: Date.now(),
        sessionId,
        payload: {
          content: result.response,
          role: "assistant",
          finishReason: "stop",
          usage: result.totalTokens,
        },
      });

      // Persist assistant message to transcript
      await appendToTranscript(sessionId, {
        id: nanoid(),
        sessionId,
        role: "assistant",
        content: result.response,
        timestamp: Date.now(),
        metadata: {
          inputTokens: result.totalTokens.inputTokens,
          outputTokens: result.totalTokens.outputTokens,
          model: result.agentId,
        },
      });

      // Send orchestration status if any delegations occurred
      if (result.delegations.length > 0) {
        sendMessage(ws, {
          id: nanoid(),
          type: "orchestration.status",
          timestamp: Date.now(),
          sessionId,
          payload: {
            activeAgents: orch.activeAgentCount,
            delegations: result.delegations.map((d) => ({
              fromAgentId: d.fromAgentId,
              toAgentId: d.toAgentId,
              reason: d.reason,
              task: d.task,
              timestamp: d.timestamp,
            })),
          },
        });
      }

      // Update session stats
      context.sessionManager.updateSessionStats(
        sessionId,
        result.totalTokens.inputTokens,
        result.totalTokens.outputTokens,
        0,
      );
    } else {
      sendError(ws, "AGENT_ERROR", result.error ?? "Agent processing failed", true);
    }

    // Send idle status
    sendMessage(ws, {
      id: nanoid(),
      type: "status",
      timestamp: Date.now(),
      sessionId,
      payload: { state: "idle" },
    });
  } catch (error) {
    logger.error({ error: String(error), sessionId }, "Failed to process chat message");
    sendError(ws, "AGENT_ERROR", "Failed to process message", true);
    sendMessage(ws, {
      id: nanoid(),
      type: "status",
      timestamp: Date.now(),
      sessionId,
      payload: { state: "error", message: String(error) },
    });
  }
}

async function handleToolApprovalResponse(
  ws: WebSocket,
  message: ProtocolMessage,
  context: ConnectionContext,
): Promise<void> {
  if (message.type !== "tool.approval.response") return;

  const { toolCallId, approved, reason } = message.payload;
  const sessionId = message.sessionId;

  logger.info(
    { sessionId, toolCallId, approved, reason },
    "Tool approval response received",
  );

  // Forward approval decision to agent runtime
  const pending = pendingApprovals.get(toolCallId);
  if (pending) {
    clearTimeout(pending.timer);
    pending.resolve(approved);
    pendingApprovals.delete(toolCallId);
    logger.info({ toolCallId, approved }, "Forwarded approval to agent runtime");
  } else {
    logger.warn({ toolCallId }, "No pending approval found for tool call");
  }

  sendMessage(ws, {
    id: nanoid(),
    type: "status",
    timestamp: Date.now(),
    sessionId,
    payload: {
      state: approved ? "tool_calling" : "idle",
      message: approved
        ? `Tool ${toolCallId} approved, executing...`
        : `Tool ${toolCallId} rejected${reason ? `: ${reason}` : ""}`,
    },
  });
}

function handleHeartbeatAck(
  ws: WebSocket,
  message: ProtocolMessage,
  _context: ConnectionContext,
): void {
  if (message.type !== "heartbeat.ack") return;

  const { clientTime } = message.payload;
  const latency = Date.now() - clientTime;

  logger.debug({ latency }, "Heartbeat acknowledged");

  // Update last-seen timestamp for the connection
  for (const [, client] of _context.connectedClients) {
    if (client.ws === ws) {
      client.lastSeen = Date.now();
      break;
    }
  }
}

async function handleSkillInvoke(
  ws: WebSocket,
  message: SkillInvokeMessage,
  context: ConnectionContext,
): Promise<void> {
  // Auth gate: require authenticated connection
  if (!context.auth) {
    sendError(ws, "UNAUTHENTICATED", "Must send a 'connect' message before invoking skills");
    return;
  }

  const { skillId, action, parameters } = message.payload;
  const sessionId = message.sessionId;

  logger.info({ sessionId, skillId, action }, "Skill invocation requested");

  sendMessage(ws, {
    id: nanoid(),
    type: "status",
    timestamp: Date.now(),
    sessionId,
    payload: {
      state: "thinking",
      message: `Invoking skill ${skillId}:${action}...`,
    },
  });

  // Forward to orchestrator as a chat message with skill context
  try {
    const orch = await getOrCreateOrchestrator();
    const session = context.sessionManager.getSession(sessionId ?? "");

    if (!session) {
      sendError(ws, "SESSION_NOT_FOUND", "Session not found for skill invocation");
      return;
    }

    const skillPrompt = `[Skill Invocation] Execute skill "${skillId}" with action "${action}". Parameters: ${JSON.stringify(parameters ?? {})}`;

    const result = await orch.handleMessage(session, skillPrompt, []);

    sendMessage(ws, {
      id: nanoid(),
      type: "skill.result",
      timestamp: Date.now(),
      sessionId,
      payload: {
        skillId,
        action,
        result: result.success ? result.response : result.error,
        isError: !result.success,
      },
    });
  } catch (error) {
    logger.error({ error: String(error), skillId, action }, "Skill invocation failed");
    sendMessage(ws, {
      id: nanoid(),
      type: "skill.result",
      timestamp: Date.now(),
      sessionId,
      payload: {
        skillId,
        action,
        result: String(error),
        isError: true,
      },
    });
  }

  sendMessage(ws, {
    id: nanoid(),
    type: "status",
    timestamp: Date.now(),
    sessionId,
    payload: { state: "idle" },
  });
}

async function handleRTCSignal(
  ws: WebSocket,
  message: RTCOfferMessage | RTCAnswerMessage | RTCIceCandidateMessage | RTCHangupMessage,
  context: ConnectionContext,
): Promise<void> {
  if (!context.auth) {
    sendError(ws, "UNAUTHENTICATED", "Must send a 'connect' message before RTC signaling");
    return;
  }

  const sourceChannelId = resolveClientIdBySocket(context.connectedClients, ws) ?? context.auth.channelId;
  const targetChannelId = message.payload.targetChannelId;
  const targetClient = context.connectedClients.get(targetChannelId);

  if (!targetClient || targetClient.ws.readyState !== targetClient.ws.OPEN) {
    sendError(ws, "RTC_PEER_NOT_FOUND", `Target peer ${targetChannelId} is not connected`);
    return;
  }

  sendMessage(targetClient.ws, {
    ...message,
    payload: {
      ...message.payload,
      sourceChannelId,
    },
  });

  logger.info(
    { type: message.type, sourceChannelId, targetChannelId, sessionId: message.sessionId },
    "Forwarded RTC signaling message",
  );
}

// ─── Broadcast ──────────────────────────────────────────────────────────────

function resolveClientIdBySocket(
  connectedClients: Map<string, ConnectedClient>,
  ws: WebSocket,
): string | null {
  for (const [clientId, client] of connectedClients) {
    if (client.ws === ws) return clientId;
  }

  return null;
}

/**
 * Broadcast an agent response to all clients subscribed to a given session.
 */
export function broadcastToSession(
  connectedClients: Map<string, ConnectedClient>,
  sessionId: string,
  message: Record<string, unknown>,
): void {
  let sent = 0;

  for (const [clientId, client] of connectedClients) {
    if (client.sessionIds.has(sessionId) && client.ws.readyState === client.ws.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
        sent++;
      } catch (error) {
        logger.error(
          { clientId, error: String(error) },
          "Failed to broadcast to client",
        );
      }
    }
  }

  logger.debug({ sessionId, recipientCount: sent }, "Broadcast complete");
}
