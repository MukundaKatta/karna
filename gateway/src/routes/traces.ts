import type { FastifyInstance } from "fastify";
import {
  TraceCollector,
  type TraceQueryOptions,
} from "../observability/trace-collector.js";

interface TraceQuerystring {
  sessionId?: string;
  agentId?: string;
  limit?: string | number;
  offset?: string | number;
  since?: string | number;
  minDurationMs?: string | number;
  success?: string | boolean;
  includeActive?: string | boolean;
  hasErrors?: string | boolean;
  toolName?: string;
}

interface TraceStatsQuerystring {
  periodMs?: string | number;
}

interface TraceParams {
  traceId: string;
}

export function registerTraceRoutes(app: FastifyInstance, traceCollector: TraceCollector): void {
  app.get<{ Querystring: TraceQuerystring }>("/api/traces", async (request, reply) => {
    const parsed = parseTraceQuery(request.query);
    if (!parsed.ok) {
      return reply.status(400).send({ error: parsed.error });
    }

    const result = traceCollector.queryTraces(parsed.filter);
    return reply.send({
      traces: result.traces,
      total: result.total,
      active: traceCollector.activeCount,
      filter: parsed.filter,
    });
  });

  app.get<{ Querystring: TraceStatsQuerystring }>("/api/traces/stats", async (request, reply) => {
    const periodMs = parseOptionalNonNegativeInt(request.query?.periodMs, "periodMs");
    if (typeof periodMs === "string") {
      return reply.status(400).send({ error: periodMs });
    }
    if (periodMs === 0) {
      return reply.status(400).send({ error: "periodMs must be greater than 0" });
    }

    return reply.send({
      stats: traceCollector.getStats(periodMs ?? 3_600_000),
      periodMs: periodMs ?? 3_600_000,
      activeTraces: traceCollector.activeCount,
      storedTraces: traceCollector.size,
    });
  });

  app.get<{ Params: TraceParams }>("/api/traces/:traceId", async (request, reply) => {
    const trace = traceCollector.getTrace(request.params.traceId);
    if (!trace) {
      return reply.status(404).send({ error: "Trace not found" });
    }

    return reply.send({
      trace,
      active: trace.endedAt === undefined,
    });
  });
}

function parseTraceQuery(query: TraceQuerystring | undefined):
  | { ok: true; filter: TraceQueryOptions }
  | { ok: false; error: string } {
  const limit = parseOptionalNonNegativeInt(query?.limit, "limit");
  if (typeof limit === "string") return { ok: false, error: limit };

  const offset = parseOptionalNonNegativeInt(query?.offset, "offset");
  if (typeof offset === "string") return { ok: false, error: offset };

  const since = parseOptionalNonNegativeInt(query?.since, "since");
  if (typeof since === "string") return { ok: false, error: since };

  const minDurationMs = parseOptionalNonNegativeInt(query?.minDurationMs, "minDurationMs");
  if (typeof minDurationMs === "string") return { ok: false, error: minDurationMs };

  const success = parseOptionalBoolean(query?.success, "success");
  if (typeof success === "string") return { ok: false, error: success };

  const includeActive = parseOptionalBoolean(query?.includeActive, "includeActive");
  if (typeof includeActive === "string") return { ok: false, error: includeActive };

  const hasErrors = parseOptionalBoolean(query?.hasErrors, "hasErrors");
  if (typeof hasErrors === "string") return { ok: false, error: hasErrors };

  return {
    ok: true,
    filter: {
      sessionId: query?.sessionId,
      agentId: query?.agentId,
      limit: limit ?? 25,
      offset,
      since,
      minDurationMs: minDurationMs ?? undefined,
      success,
      includeActive: includeActive ?? false,
      hasErrors: hasErrors ?? false,
      toolName: query?.toolName,
    },
  };
}

function parseOptionalNonNegativeInt(
  value: string | number | undefined,
  field: string,
): number | string | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return `${field} must be a non-negative number`;
  }

  return Math.floor(parsed);
}

function parseOptionalBoolean(
  value: string | boolean | undefined,
  field: string,
): boolean | string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "boolean") return value;

  const normalized = value.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return `${field} must be true or false`;
}
