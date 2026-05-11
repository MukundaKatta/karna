import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import pino, { type Logger } from "pino";

const SENSITIVE_KEY_PATTERN = /authorization|token|api[-_]?key|secret|password|cookie/i;
const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024;

export interface RequestLoggingOptions {
  logger?: Logger;
  filePath?: string;
  maxFileBytes?: number;
  routeLogLevels?: Record<string, "debug" | "info" | "warn" | "error">;
  now?: () => number;
}

declare module "fastify" {
  interface FastifyRequest {
    requestStartedAt?: number;
  }
}

export function createRequestLogger(options: RequestLoggingOptions = {}): Logger {
  if (!options.filePath) {
    return options.logger ?? pino({ name: "gateway-request-logger" });
  }

  mkdirSync(dirname(options.filePath), { recursive: true });
  rotateLogFileIfNeeded(options.filePath, options.maxFileBytes ?? DEFAULT_MAX_LOG_BYTES);
  return pino(
    { name: "gateway-request-logger" },
    pino.destination({ dest: options.filePath, sync: false }),
  );
}

export function registerRequestLogging(
  app: FastifyInstance,
  options: RequestLoggingOptions = {},
): Logger {
  const logger = createRequestLogger(options);
  const now = options.now ?? Date.now;

  app.addHook("onRequest", async (request, reply) => {
    const requestId = normalizeRequestId(request);
    request.id = requestId;
    request.requestStartedAt = now();
    reply.header("X-Request-Id", requestId);
  });

  app.addHook("onResponse", async (request, reply) => {
    const durationMs = now() - (request.requestStartedAt ?? now());
    const level = resolveRouteLogLevel(
      stripQuery(request.url),
      reply.statusCode,
      options.routeLogLevels,
    );
    logger[level](
      {
        requestId: request.id,
        method: request.method,
        path: stripQuery(request.url),
        statusCode: reply.statusCode,
        durationMs,
        route: request.routeOptions.url,
        ip: request.ip,
        request: {
          headers: redactRecord(request.headers),
          query: redactRecord(request.query),
        },
      },
      "REST request completed",
    );
  });

  return logger;
}

export function parseRouteLogLevels(raw: string | undefined): Record<string, "debug" | "info" | "warn" | "error"> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, "debug" | "info" | "warn" | "error"> = {};
    for (const [route, level] of Object.entries(parsed)) {
      if (level === "debug" || level === "info" || level === "warn" || level === "error") {
        result[route] = level;
      }
    }
    return result;
  } catch {
    return undefined;
  }
}

function resolveRouteLogLevel(
  path: string,
  statusCode: number,
  routeLogLevels?: Record<string, "debug" | "info" | "warn" | "error">,
): "debug" | "info" | "warn" | "error" {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warn";
  return routeLogLevels?.[path] ?? routeLogLevels?.["*"] ?? "info";
}

export function redactRecord(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactRecord);

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = "[redacted]";
    } else if (nested && typeof nested === "object") {
      redacted[key] = redactRecord(nested);
    } else {
      redacted[key] = nested;
    }
  }
  return redacted;
}

export function stripQuery(url: string): string {
  return url.split("?")[0] || "/";
}

export function rotateLogFileIfNeeded(filePath: string, maxBytes: number): boolean {
  if (!existsSync(filePath)) return false;
  const size = statSync(filePath).size;
  if (size < maxBytes) return false;

  renameSync(filePath, `${filePath}.${Date.now()}.1`);
  return true;
}

function normalizeRequestId(request: FastifyRequest): string {
  const header = request.headers["x-request-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  if (Array.isArray(header) && typeof header[0] === "string" && header[0].trim()) {
    return header[0].trim();
  }
  return crypto.randomUUID();
}
