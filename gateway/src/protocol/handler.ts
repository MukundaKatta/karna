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
import type { DelegationRecord } from "@karna/shared/types/orchestration.js";
import type { Session } from "@karna/shared/types/session.js";
import type { AccessPolicyManager } from "../access/policies.js";
import type { AuditLogger } from "../audit/logger.js";
import type { TraceCollector } from "../observability/trace-collector.js";
import { DEFAULT_AGENTS } from "../catalog/default-agents.js";

const logger = pino({ name: "message-handler" });
const ACCESS_CONTROLLED_CHANNELS = new Set([
  "discord",
  "google-chat",
  "imessage",
  "irc",
  "line",
  "matrix",
  "signal",
  "slack",
  "sms",
  "teams",
  "telegram",
  "whatsapp",
]);

// ─── Orchestrator Singleton ──────────────────────────────────────────────────

interface OrchestratorLike {
  activeAgentCount: number;
  init(): Promise<void>;
  shutdown?(): Promise<void>;
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

export async function restartGatewayRuntime(): Promise<{
  hadActiveOrchestrator: boolean;
  clearedPendingApprovals: number;
}> {
  const pendingApprovalCount = pendingApprovals.size;

  for (const [toolCallId, pending] of pendingApprovals) {
    clearTimeout(pending.timer);
    pending.resolve(false);
    pendingApprovals.delete(toolCallId);
  }

  const activeOrchestrator = orchestrator;
  orchestrator = null;

  if (activeOrchestrator?.shutdown) {
    await activeOrchestrator.shutdown();
  }

  return {
    hadActiveOrchestrator: activeOrchestrator !== null,
    clearedPendingApprovals: pendingApprovalCount,
  };
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
  accessPolicies: AccessPolicyManager;
  connectedClients: Map<string, ConnectedClient>;
  auditLogger?: AuditLogger;
  traceCollector?: TraceCollector;
}

export interface ConnectedClient {
  ws: WebSocket;
  auth: AuthContext | null;
  sessionIds: Set<string>;
  lastSeen: number;
}

interface ChatRoutingContext {
  userId: string;
  isDirectMessage: boolean;
  isReplyToAgent: boolean;
  agentMentioned: boolean;
}

export interface SessionTurnExecutionOptions {
  historyLimit?: number;
  traceCollector?: TraceCollector;
  streamCallback?: StreamCallback;
  approvalCallback?: (request: { toolCallId: string }) => Promise<{
    toolCallId: string;
    approved: boolean;
    reason?: string;
    respondedAt: number;
  }>;
  delegationCallback?: (record: DelegationRecord) => void;
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

export async function runSessionTurn(
  session: Session,
  content: string,
  context: Pick<ConnectionContext, "sessionManager">,
  options: SessionTurnExecutionOptions = {},
): Promise<{
  success: boolean;
  response: string;
  error?: string;
  totalTokens: { inputTokens: number; outputTokens: number };
  agentId: string;
  delegations: DelegationRecord[];
  activeAgentCount: number;
}> {
  const traceId = options.traceCollector?.startTrace(session.id);
  const historySpanId = traceId
    ? options.traceCollector?.startSpan(traceId, "load-history", "context")
    : "";
  const orch = await getOrCreateOrchestrator();
  const history = await readTranscript(session.id, options.historyLimit ?? 50);
  if (traceId && historySpanId) {
    options.traceCollector?.endSpan(traceId, historySpanId, {
      historyMessages: history.length,
    });
  }

  const modelSpanId = traceId
    ? options.traceCollector?.startSpan(traceId, "agent-turn", "model")
    : "";
  const toolSpanIds = new Map<string, string>();

  orch.setStreamCallback((event) => {
    if (traceId && modelSpanId) {
      switch (event.type) {
        case "tool_use": {
          const toolSpanId = options.traceCollector?.startSpan(
            traceId,
            event.name,
            "tool",
            modelSpanId,
          );
          if (toolSpanId) {
            toolSpanIds.set(event.id, toolSpanId);
            options.traceCollector?.addSpanEvent(traceId, toolSpanId, "requested", {
              toolCallId: event.id,
            });
            options.traceCollector?.endSpan(traceId, toolSpanId, {
              toolCallId: event.id,
              requested: true,
            });
          }
          break;
        }
        case "usage":
          options.traceCollector?.addSpanEvent(traceId, modelSpanId, "usage", {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
          });
          break;
        case "done":
          options.traceCollector?.addSpanEvent(traceId, modelSpanId, "stream.complete");
          break;
      }
    }

    options.streamCallback?.(event);
  });
  orch.setDelegationCallback(options.delegationCallback ?? (() => {}));
  orch.setApprovalCallback(
    async (request) => {
      const result = await (
        options.approvalCallback
          ?? (async (pendingRequest) => ({
            toolCallId: pendingRequest.toolCallId,
            approved: false,
            reason: "Injected session turns cannot request tool approval",
            respondedAt: Date.now(),
          }))
      )(request);

      if (traceId) {
        const toolSpanId = toolSpanIds.get(request.toolCallId);
        if (toolSpanId) {
          options.traceCollector?.addSpanEvent(
            traceId,
            toolSpanId,
            result.approved ? "approved" : "rejected",
            {
              toolCallId: request.toolCallId,
            },
          );
          if (!result.approved) {
            options.traceCollector?.setSpanError(
              traceId,
              toolSpanId,
              result.reason ?? "Tool request rejected",
            );
          }
        }
      }

      return result;
    },
  );

  let result: Awaited<ReturnType<OrchestratorLike["handleMessage"]>>;
  try {
    result = await orch.handleMessage(session, content, history);
  } catch (error) {
    if (traceId && modelSpanId) {
      options.traceCollector?.setSpanError(traceId, modelSpanId, String(error));
      options.traceCollector?.endSpan(traceId, modelSpanId, {
        historyMessages: history.length,
      });
      options.traceCollector?.endTrace(traceId, {
        success: false,
        model: "",
        inputTokens: 0,
        outputTokens: 0,
        error: String(error),
      });
    }

    throw error;
  }

  if (result.success) {
    await appendToTranscript(session.id, {
      id: nanoid(),
      sessionId: session.id,
      role: "assistant",
      content: result.response,
      timestamp: Date.now(),
      metadata: {
        inputTokens: result.totalTokens.inputTokens,
        outputTokens: result.totalTokens.outputTokens,
        model: result.agentId,
      },
    });

    context.sessionManager.updateSessionStats(
      session.id,
      result.totalTokens.inputTokens,
      result.totalTokens.outputTokens,
      0,
    );
  }

  if (traceId && modelSpanId) {
    if (!result.success && result.error) {
      options.traceCollector?.setSpanError(traceId, modelSpanId, result.error);
    }
    if (result.delegations.length > 0) {
      options.traceCollector?.addSpanEvent(traceId, modelSpanId, "delegations", {
        count: result.delegations.length,
      });
    }
    options.traceCollector?.endSpan(traceId, modelSpanId, {
      agentId: result.agentId,
      historyMessages: history.length,
      delegationCount: result.delegations.length,
      inputTokens: result.totalTokens.inputTokens,
      outputTokens: result.totalTokens.outputTokens,
      success: result.success,
    });
    options.traceCollector?.endTrace(traceId, {
      success: result.success,
      agentId: result.agentId,
      model: "",
      inputTokens: result.totalTokens.inputTokens,
      outputTokens: result.totalTokens.outputTokens,
      error: result.error,
    });
  }

  return {
    ...result,
    activeAgentCount: orch.activeAgentCount,
  };
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
    deriveUserId(channelId, metadata),
    metadata,
    message.sessionId,
  );

  await context.auditLogger?.logSession(
    "session.created",
    session.id,
    session.userId,
    { channelType, channelId },
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

  if (ACCESS_CONTROLLED_CHANNELS.has(session.channelType)) {
    const routing = resolveChatRoutingContext(session, message);

    if (routing.isDirectMessage) {
      const decision = context.accessPolicies.checkDmAccess(session.channelType, routing.userId);

      if (!decision.allowed) {
        let response = decision.reason;

        if (decision.reason.includes("Pairing required")) {
          const pairing = context.accessPolicies.issuePairingCode(session.channelType, routing.userId);
          response =
            `Karna is locked for new ${session.channelType} DMs.\n\n` +
            `Approve this conversation with:\n` +
            `karna access approve ${session.channelType} ${pairing.code}\n\n` +
            `Pairing code: ${pairing.code}`;
        } else if (decision.reason.includes("closed")) {
          response =
            `Karna is not accepting new ${session.channelType} DMs right now.\n` +
            `Ask an operator to allowlist this chat if it should be trusted.`;
        } else if (decision.reason.includes("blocklisted")) {
          response = `This ${session.channelType} conversation is blocked from reaching Karna.`;
        }

        sendMessage(ws, {
          id: nanoid(),
          type: "agent.response",
          timestamp: Date.now(),
          sessionId,
          payload: {
            content: response,
            role: "assistant",
            finishReason: "stop",
          },
        });

        sendMessage(ws, {
          id: nanoid(),
          type: "status",
          timestamp: Date.now(),
          sessionId,
          payload: { state: "idle" },
        });

        logger.info(
          { sessionId, channelType: session.channelType, userId: routing.userId, reason: decision.reason },
          "Blocked inbound chat by DM access policy",
        );
        return;
      }
    } else {
      const decision = context.accessPolicies.checkGroupAccess(
        session.channelType,
        routing.userId,
        content,
        routing.isReplyToAgent,
        routing.agentMentioned,
      );

      if (!decision.allowed) {
        sendMessage(ws, {
          id: nanoid(),
          type: "status",
          timestamp: Date.now(),
          sessionId,
          payload: { state: "idle" },
        });

        logger.info(
          { sessionId, channelType: session.channelType, userId: routing.userId, reason: decision.reason },
          "Blocked inbound chat by group access policy",
        );
        return;
      }
    }
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
    const result = await runSessionTurn(session, content, context, {
      historyLimit: 50,
      traceCollector: context.traceCollector,
      streamCallback,
      approvalCallback: async (request) => {
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            pendingApprovals.delete(request.toolCallId);
            resolve({
              toolCallId: request.toolCallId,
              approved: false,
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
      },
      delegationCallback: (record: DelegationRecord) => {
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
      },
    });

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

      // Send orchestration status if any delegations occurred
      if (result.delegations.length > 0) {
        sendMessage(ws, {
          id: nanoid(),
          type: "orchestration.status",
          timestamp: Date.now(),
          sessionId,
          payload: {
            activeAgents: result.activeAgentCount,
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
    const traceId = context.traceCollector?.startTrace(session.id);
    const skillSpanId = traceId
      ? context.traceCollector?.startSpan(traceId, `${skillId}:${action}`, "skill")
      : "";
    let result: Awaited<ReturnType<OrchestratorLike["handleMessage"]>>;
    try {
      result = await orch.handleMessage(session, skillPrompt, []);
    } catch (error) {
      if (traceId && skillSpanId) {
        context.traceCollector?.setSpanError(traceId, skillSpanId, String(error));
        context.traceCollector?.endSpan(traceId, skillSpanId, { success: false });
        context.traceCollector?.endTrace(traceId, {
          success: false,
          model: "",
          inputTokens: 0,
          outputTokens: 0,
          error: String(error),
        });
      }
      throw error;
    }

    if (traceId && skillSpanId) {
      if (!result.success && result.error) {
        context.traceCollector?.setSpanError(traceId, skillSpanId, result.error);
      }
      context.traceCollector?.endSpan(traceId, skillSpanId, {
        agentId: result.agentId,
        success: result.success,
      });
      context.traceCollector?.endTrace(traceId, {
        success: result.success,
        agentId: result.agentId,
        model: "",
        inputTokens: result.totalTokens.inputTokens,
        outputTokens: result.totalTokens.outputTokens,
        error: result.error,
      });
    }

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

  const sourceChannelId = resolveClientIdBySocket(context.connectedClients, ws) ?? context.auth.deviceId;
  const targetChannelId = message.payload.targetChannelId;

  if (targetChannelId === sourceChannelId) {
    sendError(ws, "RTC_INVALID_TARGET", "Cannot start a live voice session with the same channel");
    return;
  }

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
): number {
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
  return sent;
}

function deriveUserId(
  channelId: string,
  metadata: Record<string, unknown> | undefined,
): string {
  const candidates = [
    metadata?.["userId"],
    metadata?.["phoneNumber"],
    metadata?.["jid"],
    metadata?.["handle"],
    metadata?.["chatId"],
    metadata?.["clientId"],
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
    if (typeof candidate === "number") {
      return String(candidate);
    }
  }

  return channelId;
}

function resolveChatRoutingContext(session: Session, message: ChatMessage): ChatRoutingContext {
  const sessionMetadata = asMetadataRecord(session.metadata);
  const messageMetadata = asMetadataRecord(message.payload.metadata);
  const combinedMetadata = { ...sessionMetadata, ...messageMetadata };

  return {
    userId:
      firstNonEmptyString(
        messageMetadata["senderUserId"],
        messageMetadata["userId"],
        sessionMetadata["senderUserId"],
        sessionMetadata["userId"],
      ) ??
      session.userId ??
      session.channelId,
    isDirectMessage: inferDirectMessage(session.channelType, combinedMetadata),
    isReplyToAgent: coerceBoolean(messageMetadata["isReplyToAgent"]) ?? false,
    agentMentioned: coerceBoolean(messageMetadata["agentMentioned"]) ?? false,
  };
}

function inferDirectMessage(channelType: string, metadata: Record<string, unknown>): boolean {
  const explicitDirect = coerceBoolean(metadata["isDirectMessage"]);
  if (explicitDirect !== undefined) return explicitDirect;

  const explicitGroup = coerceBoolean(metadata["isGroup"]);
  if (explicitGroup !== undefined) return !explicitGroup;

  const conversationType = firstNonEmptyString(metadata["conversationType"]);
  if (conversationType) {
    const normalized = conversationType.toLowerCase();
    if (normalized === "personal" || normalized === "im" || normalized === "dm" || normalized === "direct") {
      return true;
    }
    if (normalized === "channel" || normalized === "groupchat" || normalized === "group") {
      return false;
    }
  }

  const spaceType = firstNonEmptyString(metadata["spaceType"]);
  if (spaceType) {
    return spaceType.toUpperCase() === "DM";
  }

  const replyTarget = firstNonEmptyString(metadata["replyTarget"]);
  if (replyTarget) {
    return !(replyTarget.startsWith("#") || replyTarget.startsWith("&"));
  }

  switch (channelType) {
    case "discord":
    case "slack":
    case "teams":
    case "google-chat":
    case "irc":
      return false;
    default:
      return true;
  }
}

function asMetadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function coerceBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
