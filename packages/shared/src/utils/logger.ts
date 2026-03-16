import pino from "pino";
import type { Logger as PinoLogger } from "pino";

// ─── Types ───────────────────────────────────────────────────────────────────

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LoggerOptions {
  name: string;
  level?: LogLevel;
  pretty?: boolean;
  redact?: string[];
  base?: Record<string, unknown>;
}

export type Logger = PinoLogger;

// ─── Default Redaction Paths ─────────────────────────────────────────────────

const DEFAULT_REDACT_PATHS = [
  "*.apiKey",
  "*.token",
  "*.secret",
  "*.password",
  "*.authorization",
  "req.headers.authorization",
  "req.headers.cookie",
];

// ─── Logger Factory ──────────────────────────────────────────────────────────

/**
 * Create a structured logger with sensible defaults for Karna services.
 *
 * @param options - Logger configuration
 * @returns A pino logger instance
 *
 * @example
 * ```ts
 * const logger = createLogger({ name: "gateway", level: "debug" });
 * logger.info({ sessionId: "abc" }, "Connection established");
 * ```
 */
export function createLogger(options: LoggerOptions): Logger {
  const { name, level = "info", pretty = false, redact, base } = options;

  const redactPaths = redact
    ? [...new Set([...DEFAULT_REDACT_PATHS, ...redact])]
    : DEFAULT_REDACT_PATHS;

  const transport: pino.TransportSingleOptions | undefined = pretty
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined;

  return pino({
    name,
    level,
    redact: {
      paths: redactPaths,
      censor: "[REDACTED]",
    },
    base: {
      service: name,
      ...base,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    ...(transport ? { transport } : {}),
  });
}

/**
 * Create a child logger with additional bound context.
 *
 * @param parent - The parent logger
 * @param bindings - Additional context to bind to every log entry
 * @returns A child logger
 *
 * @example
 * ```ts
 * const sessionLogger = createChildLogger(logger, { sessionId: "abc", channel: "web" });
 * sessionLogger.info("Processing message");
 * ```
 */
export function createChildLogger(
  parent: Logger,
  bindings: Record<string, unknown>
): Logger {
  return parent.child(bindings);
}
