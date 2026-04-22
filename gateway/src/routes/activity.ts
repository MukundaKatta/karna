import type { FastifyInstance } from "fastify";
import { AUDIT_EVENT_TYPES, type AuditEventType, type AuditLogger } from "../audit/logger.js";

interface ActivityQuerystring {
  eventType?: string;
  actorId?: string;
  sessionId?: string;
  since?: string | number;
  limit?: string | number;
}

export function registerActivityRoutes(app: FastifyInstance, auditLogger: AuditLogger): void {
  app.get<{ Querystring: ActivityQuerystring }>("/api/activity", async (request, reply) => {
    const parsed = parseActivityQuery(request.query);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    const events = await auditLogger.query(parsed.query);
    const ordered = [...events].sort((left, right) => right.timestamp - left.timestamp);

    return reply.send({
      events: ordered,
      total: ordered.length,
      filters: parsed.query,
    });
  });
}

function parseActivityQuery(query: ActivityQuerystring | undefined):
  | {
      ok: true;
      query: {
        eventType?: AuditEventType;
        actorId?: string;
        sessionId?: string;
        since?: number;
        limit?: number;
      };
    }
  | { ok: false; error: string } {
  const parsed: {
    eventType?: AuditEventType;
    actorId?: string;
    sessionId?: string;
    since?: number;
    limit?: number;
  } = {};

  if (query?.eventType) {
    if (!AUDIT_EVENT_TYPES.includes(query.eventType as AuditEventType)) {
      return { ok: false, error: "Invalid eventType filter" };
    }
    parsed.eventType = query.eventType as AuditEventType;
  }

  if (query?.actorId?.trim()) {
    parsed.actorId = query.actorId.trim();
  }

  if (query?.sessionId?.trim()) {
    parsed.sessionId = query.sessionId.trim();
  }

  const since = parseOptionalPositiveInt(query?.since, "since");
  if (typeof since === "string") {
    return { ok: false, error: since };
  }
  if (since !== undefined) {
    parsed.since = since;
  }

  const limit = parseOptionalPositiveInt(query?.limit, "limit");
  if (typeof limit === "string") {
    return { ok: false, error: limit };
  }
  if (limit !== undefined) {
    parsed.limit = limit;
  }

  return { ok: true, query: parsed };
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
