import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type { Session } from "@karna/shared/types/session.js";
import { appendToTranscript } from "../session/store.js";
import { broadcastToSession, restartGatewayRuntime, type ConnectedClient } from "../protocol/handler.js";
import type { SessionManager } from "../session/manager.js";
import type { AuditLogger } from "../audit/logger.js";
import type { TraceCollector } from "../observability/trace-collector.js";

interface MessageBody {
  channelId?: string;
  content?: string;
  channelType?: string;
  replyToMessageId?: string;
  fromSessionId?: string;
}

interface RestartBody {
  requestedBy?: string;
  reason?: string;
}

export function registerControlRoutes(
  app: FastifyInstance,
  services: {
    sessionManager: SessionManager;
    connectedClients: Map<string, ConnectedClient>;
    auditLogger?: AuditLogger;
    traceCollector?: TraceCollector;
  },
): void {
  app.post<{ Body: MessageBody }>("/api/message", async (request, reply) => {
    const content = request.body?.content?.trim();
    const channelId = request.body?.channelId?.trim();

    if (!channelId) {
      return reply.status(400).send({ error: "channelId is required" });
    }
    if (!content) {
      return reply.status(400).send({ error: "content is required" });
    }

    const targetSession = resolveTargetSession(
      services.sessionManager,
      services.connectedClients,
      channelId,
      request.body?.channelType,
    );

    if (!targetSession) {
      return reply.status(404).send({ error: "Target session or channel not found" });
    }

    const timestamp = Date.now();
    await appendToTranscript(targetSession.id, {
      id: nanoid(),
      sessionId: targetSession.id,
      role: "assistant",
      content,
      timestamp,
      metadata: {
        toolName: "message-api",
        finishReason: "stop",
      },
    });

    const recipients = broadcastToSession(services.connectedClients, targetSession.id, {
      id: nanoid(),
      type: "agent.response",
      timestamp,
      sessionId: targetSession.id,
      payload: {
        content,
        role: "assistant",
        finishReason: "stop",
      },
    });

    return reply.send({
      success: true,
      sessionId: targetSession.id,
      channelId: targetSession.channelId,
      channelType: targetSession.channelType,
      delivered: recipients > 0,
      liveRecipients: recipients,
      persisted: true,
    });
  });

  app.post<{ Body: RestartBody }>("/api/restart", async (request) => {
    const restarted = await restartGatewayRuntime();

    return {
      success: true,
      mode: "soft",
      restartedAt: Date.now(),
      requestedBy: request.body?.requestedBy,
      reason: request.body?.reason,
      ...restarted,
    };
  });
}

function resolveTargetSession(
  sessionManager: SessionManager,
  connectedClients: Map<string, ConnectedClient>,
  channelId: string,
  channelType?: string,
): Session | null {
  const directSession = sessionManager.getSession(channelId);
  if (directSession) {
    return directSession;
  }

  const filteredSessions = sessionManager.querySessions(
    {
      channelId,
      ...(channelType ? { channelType } : {}),
    },
    { limit: 1 },
  );
  if (filteredSessions[0]) {
    return filteredSessions[0];
  }

  const client = connectedClients.get(channelId);
  if (!client) {
    return null;
  }

  const liveSessions = Array.from(client.sessionIds)
    .map((sessionId) => sessionManager.getSession(sessionId))
    .filter((session): session is Session => Boolean(session))
    .filter((session) => !channelType || session.channelType === channelType)
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return liveSessions[0] ?? null;
}
