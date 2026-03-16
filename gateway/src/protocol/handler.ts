import type { WebSocket } from "@fastify/websocket";
import { nanoid } from "nanoid";
import pino from "pino";
import type {
  ProtocolMessage,
  ConnectMessage,
  ChatMessage,
  SkillInvokeMessage,
} from "./schema.js";
import type { AuthContext } from "./auth.js";
import { validateToken, generateChallenge, verifyChallenge, createAuthContext } from "./auth.js";
import type { SessionManager } from "../session/manager.js";
import type { HeartbeatScheduler } from "../heartbeat/scheduler.js";

const logger = pino({ name: "message-handler" });

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

  // TODO: Forward to agent runtime for processing
  // For now, acknowledge receipt. The agent runtime integration will
  // handle sending agent.response messages back through the WebSocket.
  logger.debug({ sessionId }, "Message queued for agent processing");
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

  // TODO: Forward approval decision to agent runtime
  // The agent runtime will continue or abort tool execution based on this.

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
  const { skillId, action, parameters } = message.payload;
  const sessionId = message.sessionId;

  logger.info({ sessionId, skillId, action }, "Skill invocation requested");

  // TODO: Forward to skill execution engine
  // For now, acknowledge receipt.

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
}

// ─── Broadcast ──────────────────────────────────────────────────────────────

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
