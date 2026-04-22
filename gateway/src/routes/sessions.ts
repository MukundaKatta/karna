import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { SessionStatusSchema, type SessionStatus } from "@karna/shared/types/session.js";
import { SessionManager, type SessionFilter } from "../session/manager.js";
import type { AuditLogger } from "../audit/logger.js";
import type { TraceCollector } from "../observability/trace-collector.js";
import {
  appendToTranscript,
  deleteTranscript,
  getTranscriptLength,
  readTranscript,
} from "../session/store.js";
import { runSessionTurn } from "../protocol/handler.js";

interface SessionQuerystring {
  channelType?: string;
  channelId?: string;
  userId?: string;
  status?: string;
  limit?: string | number;
  staleAfterMs?: string | number;
  all?: string | boolean;
}

interface SessionParams {
  sessionId: string;
}

interface UpdateSessionBody {
  status?: SessionStatus;
}

interface SessionHistoryQuerystring {
  limit?: string | number;
}

interface SessionMessageBody {
  content?: string;
  role?: "user" | "assistant" | "system";
  replyBack?: boolean;
  metadata?: Record<string, unknown>;
}

export function registerSessionRoutes(
  app: FastifyInstance,
  sessionManager: SessionManager,
  auditLogger?: AuditLogger,
  traceCollector?: TraceCollector,
): void {
  app.get<{ Querystring: SessionQuerystring }>("/api/sessions", async (request, reply) => {
    const parsed = parseSessionQuery(request.query);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    const sessions = sessionManager.querySessions(parsed.filter, {
      limit: parsed.limit,
    });

    return reply.send({
      sessions,
      total: sessions.length,
      filter: parsed.filter,
    });
  });

  app.get<{ Querystring: SessionQuerystring }>("/api/sessions/summary", async (request, reply) => {
    const parsed = parseSessionQuery(request.query);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    return reply.send({
      summary: sessionManager.summarizeSessions(parsed.filter, parsed.staleAfterMs),
      filter: parsed.filter,
    });
  });

  app.get<{ Params: SessionParams }>("/api/sessions/:sessionId", async (request, reply) => {
    const session = sessionManager.getSession(request.params.sessionId);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    return reply.send({ session });
  });

  app.get<{ Params: SessionParams; Querystring: SessionHistoryQuerystring }>(
    "/api/sessions/:sessionId/history",
    async (request, reply) => {
      const parsedLimit = parseOptionalPositiveInt(request.query?.limit, "limit");
      if (typeof parsedLimit === "string") {
        return reply.status(400).send({ error: parsedLimit });
      }

      const totalMessages = await getTranscriptLength(request.params.sessionId);
      if (!sessionManager.getSession(request.params.sessionId) && totalMessages === 0) {
        return reply.status(404).send({ error: "Session transcript not found" });
      }

      const messages = await readTranscript(request.params.sessionId, parsedLimit);
      return reply.send({
        sessionId: request.params.sessionId,
        messages,
        totalMessages,
        hasMore: totalMessages > messages.length,
      });
    },
  );

  app.delete<{ Params: SessionParams }>(
    "/api/sessions/:sessionId/history",
    async (request, reply) => {
      const cleared = await deleteTranscript(request.params.sessionId);
      return reply.send({ cleared, sessionId: request.params.sessionId });
    },
  );

  app.post<{ Params: SessionParams; Body: SessionMessageBody }>(
    "/api/sessions/:sessionId/message",
    async (request, reply) => {
      const session = sessionManager.getSession(request.params.sessionId);
      if (!session) {
        return reply.status(404).send({ error: "Session not found" });
      }

      const content = request.body?.content?.trim();
      if (!content) {
        return reply.status(400).send({ error: "content is required" });
      }

      const role = request.body?.role ?? "system";
      if (!["user", "assistant", "system"].includes(role)) {
        return reply.status(400).send({ error: "role must be user, assistant, or system" });
      }
      const replyBack = request.body?.replyBack ?? false;
      const metadata = {
        toolName: "session-api",
        finishReason: replyBack ? "reply-back" : "queued",
      };

      await appendToTranscript(session.id, {
        id: nanoid(),
        sessionId: session.id,
        role,
        content,
        timestamp: Date.now(),
        metadata,
      });

      if (!replyBack) {
        return reply.send({
          success: true,
          queued: true,
          sessionId: session.id,
          replyBack: false,
        });
      }

      const prompt = role === "system" ? `[System message] ${content}` : content;
      const result = await runSessionTurn(session, prompt, { sessionManager }, {
        historyLimit: 50,
        traceCollector,
      });

      if (!result.success) {
        return reply.status(502).send({
          success: false,
          error: result.error ?? "Injected session turn failed",
          sessionId: session.id,
        });
      }

      return reply.send({
        success: true,
        queued: false,
        sessionId: session.id,
        replyBack: true,
        response: result.response,
        usage: result.totalTokens,
        delegations: result.delegations,
        agentId: result.agentId,
      });
    },
  );

  app.patch<{ Params: SessionParams; Body: UpdateSessionBody }>(
    "/api/sessions/:sessionId",
    async (request, reply) => {
      const parsedStatus = SessionStatusSchema.safeParse(request.body?.status);
      if (!parsedStatus.success) {
        return reply.status(400).send({ error: "A valid status is required" });
      }
      if (parsedStatus.data === "terminated") {
        return reply.status(400).send({ error: "Use DELETE /api/sessions/:sessionId to terminate a session" });
      }

      const updated = sessionManager.updateSessionStatus(
        request.params.sessionId,
        parsedStatus.data,
      );
      if (!updated) {
        return reply.status(404).send({ error: "Session not found" });
      }

      return reply.send({ session: sessionManager.getSession(request.params.sessionId) });
    },
  );

  app.delete<{ Params: SessionParams }>("/api/sessions/:sessionId", async (request, reply) => {
    const session = sessionManager.getSession(request.params.sessionId);
    const removed = sessionManager.terminateSession(request.params.sessionId);
    if (!removed) {
      return reply.status(404).send({ error: "Session not found" });
    }

    await auditLogger?.logSession(
      "session.terminated",
      request.params.sessionId,
      session?.userId,
      session ? { channelType: session.channelType, channelId: session.channelId } : undefined,
    );

    return reply.send({ removed: true, sessionId: request.params.sessionId });
  });

  app.delete<{ Querystring: SessionQuerystring }>("/api/sessions", async (request, reply) => {
    const parsed = parseSessionQuery(request.query);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    const shouldRemoveAll = isTruthy(request.query?.all);
    if (!shouldRemoveAll && !hasAnyFilter(parsed.filter)) {
      return reply.status(400).send({
        error: "Provide at least one filter or pass all=true to terminate every live session",
      });
    }

    const sessionsToRemove = shouldRemoveAll
      ? sessionManager.querySessions({})
      : sessionManager.querySessions(parsed.filter);

    const removed = shouldRemoveAll
      ? sessionManager.terminateSessions({})
      : sessionManager.terminateSessions(parsed.filter);

    await Promise.all(
      sessionsToRemove.map((session) =>
        auditLogger?.logSession("session.terminated", session.id, session.userId, {
          channelType: session.channelType,
          channelId: session.channelId,
        }) ?? Promise.resolve(),
      ),
    );

    return reply.send({ removed });
  });
}

function parseSessionQuery(query: SessionQuerystring | undefined):
  | { ok: true; filter: SessionFilter; limit?: number; staleAfterMs: number }
  | { ok: false; error: string } {
  const filter: SessionFilter = {};

  if (query?.channelType?.trim()) {
    filter.channelType = query.channelType.trim();
  }

  if (query?.channelId?.trim()) {
    filter.channelId = query.channelId.trim();
  }

  if (query?.userId?.trim()) {
    filter.userId = query.userId.trim();
  }

  if (query?.status) {
    const parsedStatus = SessionStatusSchema.safeParse(query.status);
    if (!parsedStatus.success) {
      return { ok: false, error: "Invalid status filter" };
    }
    filter.status = parsedStatus.data;
  }

  const limit = parseOptionalPositiveInt(query?.limit, "limit");
  if (typeof limit === "string") {
    return { ok: false, error: limit };
  }

  const staleAfterMs = parseOptionalPositiveInt(query?.staleAfterMs, "staleAfterMs");
  if (typeof staleAfterMs === "string") {
    return { ok: false, error: staleAfterMs };
  }

  return {
    ok: true,
    filter,
    limit,
    staleAfterMs: staleAfterMs ?? 30 * 60_000,
  };
}

function parseOptionalPositiveInt(
  value: string | number | undefined,
  field: string,
): number | undefined | string {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return `${field} must be a positive integer`;
  }

  return parsed;
}

function hasAnyFilter(filter: SessionFilter): boolean {
  return Boolean(filter.channelType || filter.channelId || filter.userId || filter.status);
}

function isTruthy(value: string | boolean | undefined): boolean {
  return value === true || value === "true" || value === "1";
}
