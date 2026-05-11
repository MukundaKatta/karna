import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import pino from "pino";
import { nanoid } from "nanoid";
import { parseMessageDetailed } from "./protocol/schema.js";
import {
  checkWebSocketMessageRate,
  resolveWebSocketLimitConfig,
  validateWebSocketMessageSize,
  type BandwidthTracker,
  type MessageRateBucket,
} from "./protocol/limits.js";
import { handleMessage, type ConnectedClient, type ConnectionContext } from "./protocol/handler.js";
import { SessionManager } from "./session/manager.js";
import { HeartbeatScheduler } from "./heartbeat/scheduler.js";
import { getConfigPath, loadConfig } from "./config/loader.js";
import { getSystemHealth, setConnectionCounter, setSessionCounter } from "./health/status.js";
import { MetricsCollector } from "./health/metrics.js";
import { validateGatewayEnv } from "./config/validate-env.js";
import { MemoryStore, InMemoryBackend } from "@karna/agent/memory/store.js";
import { SupabaseMemoryBackend } from "@karna/agent/memory/supabase-backend.js";
import { createSupabaseClient } from "@karna/supabase";
import { registerMemoryRoutes } from "./routes/memory.js";
import { AccessPolicyManager } from "./access/policies.js";
import { registerAccessRoutes } from "./routes/access.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerActivityRoutes } from "./routes/activity.js";
import { registerOpenApiRoutes } from "./routes/openapi.js";
import { registerModerationRoutes } from "./routes/moderation.js";
import { registerTraceRoutes } from "./routes/traces.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerControlRoutes } from "./routes/control.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";
import { AuditLogger } from "./audit/logger.js";
import { TraceCollector } from "./observability/trace-collector.js";
import {
  buildAnalyticsSummary,
  getAnalyticsWindowStart,
  parseAnalyticsPeriod,
} from "./analytics/summary.js";
import {
  resolveGatewayCorsOrigins,
  resolveGatewayHost,
  resolveGatewayPort,
  isGatewayOriginAllowed,
} from "./config/runtime-env.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { WorkflowEngine } from "@karna/agent/workflows/engine.js";
import { createDefaultWorkflows } from "./catalog/default-workflows.js";
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  buildShutdownNotice,
  closeClientsForShutdown,
  notifyClientsOfShutdown,
  trackInFlight,
  waitForInFlight,
} from "./shutdown/graceful.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = pino({
  name: "karna-gateway",
  level: process.env["LOG_LEVEL"] ?? "info",
});

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate environment before anything else
  const envResult = validateGatewayEnv();
  if (!envResult.valid) {
    process.exit(1);
  }

  // Load configuration
  const config = await loadConfig();
  const configPath = getConfigPath();
  const port = resolveGatewayPort(config);
  const host = resolveGatewayHost(config);

  // Initialize core services
  const sessionManager = new SessionManager({
    maxSessions: 1000,
    sessionTimeoutMs: config.gateway.sessionTimeoutMs,
  });
  sessionManager.start();

  const heartbeatScheduler = new HeartbeatScheduler();
  if (config.agent.workspacePath) {
    heartbeatScheduler.setWorkspacePath(config.agent.workspacePath);
  }

  const metricsCollector = new MetricsCollector();
  let memoryStore = new MemoryStore(new InMemoryBackend());
  const accessPolicies = new AccessPolicyManager({
    storagePath: join(homedir(), ".karna", "access", "policies.json"),
  });
  const auditLogger = new AuditLogger();
  const traceCollector = new TraceCollector();
  const workflowEngine = new WorkflowEngine();
  for (const workflow of createDefaultWorkflows()) {
    workflowEngine.register(workflow);
  }

  if (
    config.memory.enabled &&
    (config.memory.backend === "supabase" || process.env["SUPABASE_URL"])
  ) {
    try {
      const supabase = createSupabaseClient();
      memoryStore = new MemoryStore(new SupabaseMemoryBackend(supabase));
      logger.info("Memory store configured with Supabase pgvector backend");
    } catch (error) {
      logger.warn({ error: String(error) }, "Falling back to in-memory memory store");
    }
  }

  // Connected clients registry
  const connectedClients = new Map<string, ConnectedClient>();
  const inFlightMessages = new Set<Promise<unknown>>();
  let isDraining = false;
  const websocketLimits = resolveWebSocketLimitConfig(config.gateway.websocket);

  // Wire up health counters
  setConnectionCounter(() => connectedClients.size);
  setSessionCounter(() => sessionManager.activeSessionCount);

  // Create Fastify server
  const server = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
    },
    genReqId: () => nanoid(),
  });

  server.addHook("onRequest", async (request, reply) => {
    if (!isDraining || request.url === "/health") return;

    reply.header("Connection", "close");
    return reply.status(503).send({
      error: "server_shutdown",
      message: "Gateway is draining connections for shutdown",
      retryable: true,
    });
  });

  // Register WebSocket plugin
  await server.register(websocket, {
    options: {
      maxPayload: websocketLimits.maxMediaPayloadBytes,
    },
  });

  // ─── CORS ──────────────────────────────────────────────────────────────

  const corsOrigins = resolveGatewayCorsOrigins(config);

  await server.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    credentials: true,
    maxAge: 86_400,
  });

  // ─── Security Headers ─────────────────────────────────────────────────

  server.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "0");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (process.env["NODE_ENV"] === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  // ─── Health Endpoint ────────────────────────────────────────────────────

  server.get("/health", async (_request, reply) => {
    const health = getSystemHealth();
    const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503;
    return reply.status(statusCode).send(health);
  });

  // ─── Metrics Endpoint ───────────────────────────────────────────────────

  server.get("/metrics", async (_request, reply) => {
    return reply.send(metricsCollector.getMetrics());
  });

  // ─── Prometheus Metrics Endpoint ──────────────────────────────────────

  server.get("/metrics/prometheus", async (_request, reply) => {
    const text = metricsCollector.getPrometheusMetrics(
      connectedClients.size,
      sessionManager.activeSessionCount,
    );
    return reply.type("text/plain; version=0.0.4; charset=utf-8").send(text);
  });

  // ─── Analytics REST API ───────────────────────────────────────────────

  server.get<{ Querystring: { period?: string } }>("/api/analytics", async (request, reply) => {
    const periodDays = parseAnalyticsPeriod(request.query?.period);
    if (!periodDays) {
      return reply.status(400).send({ error: "period must be one of 7d, 14d, or 30d" });
    }

    const sessions = sessionManager.listAllSessions();
    const metrics = metricsCollector.getMetrics();
    const since = getAnalyticsWindowStart(periodDays);
    const traces = traceCollector.queryTraces({
      limit: 10_000,
      since,
    }).traces;
    const sessionEvents = await auditLogger.query({
      eventType: "session.created",
      since,
      limit: 10_000,
    });

    return reply.send(
      buildAnalyticsSummary({
        sessions,
        connectedClients: connectedClients.size,
        metrics,
        traces,
        sessionsCreated: sessionEvents.length,
        periodDays,
      }),
    );
  });

  registerMemoryRoutes(server, memoryStore);
  registerModerationRoutes(server);
  registerAccessRoutes(server, accessPolicies);
  registerSessionRoutes(server, sessionManager, auditLogger, traceCollector);
  registerActivityRoutes(server, auditLogger);
  registerTraceRoutes(server, traceCollector);
  registerApiRoutes(server, { traceCollector, auditLogger });
  registerRuntimeRoutes(server, {
    config,
    configPath,
    sessionManager,
    connectedClients,
    accessPolicies,
    workflowEngine,
  });
  registerWorkflowRoutes(server, workflowEngine);
  registerControlRoutes(server, { sessionManager, connectedClients, auditLogger, traceCollector });
  registerOpenApiRoutes(server);

  // ─── WebSocket Route ────────────────────────────────────────────────────

  server.get("/ws", { websocket: true }, (socket, request) => {
    const connectionId = nanoid();
    const requestOrigin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    let invalidMessageCount = 0;
    const bandwidthTracker: BandwidthTracker = {
      windowStartedAt: Date.now(),
      bytes: 0,
    };
    const rateBuckets = new Map<string, MessageRateBucket>();
    if (!isGatewayOriginAllowed(requestOrigin, corsOrigins)) {
      logger.warn({ connectionId, requestOrigin }, "Rejected WebSocket connection from untrusted origin");
      socket.close(1008, "Origin not allowed");
      return;
    }

    if (isDraining) {
      socket.send(JSON.stringify(buildShutdownNotice("draining")));
      socket.close(1001, "Server shutting down");
      return;
    }

    logger.info({ connectionId }, "WebSocket connection opened");

    const context: ConnectionContext = {
      ws: socket,
      auth: null,
      sessionManager,
      heartbeatScheduler,
      accessPolicies,
      connectedClients,
      auditLogger,
      traceCollector,
      requestOrigin: requestOrigin ?? null,
      allowedOrigins: corsOrigins,
    };

    socket.on("message", (rawData: Buffer | string) => {
      const limitResult = validateWebSocketMessageSize(
        rawData,
        websocketLimits,
        bandwidthTracker,
      );
      if (!limitResult.ok) {
        logger.warn(
          {
            connectionId,
            code: limitResult.code,
            sizeBytes: limitResult.sizeBytes,
            bandwidthBytes: bandwidthTracker.bytes,
          },
          "Rejected oversized or excessive WebSocket message",
        );
        socket.send(
          JSON.stringify({
            id: nanoid(),
            type: "error",
            timestamp: Date.now(),
            payload: {
              code: limitResult.code,
              message: limitResult.message,
              retryable: limitResult.code === "BANDWIDTH_LIMIT_EXCEEDED",
            },
          }),
        );
        return;
      }

      const parsed = parseMessageDetailed(rawData as string | Buffer);

      if (!parsed.ok) {
        invalidMessageCount++;
        socket.send(
          JSON.stringify({
            id: nanoid(),
            type: "error",
            timestamp: Date.now(),
            payload: {
              code: "INVALID_MESSAGE",
              message: parsed.error,
              details: {
                fieldErrors: parsed.fieldErrors,
                formErrors: parsed.formErrors,
                rawType: parsed.rawType,
                invalidMessageCount,
              },
              retryable: invalidMessageCount < 5,
            },
          }),
        );
        if (invalidMessageCount >= 5) {
          socket.close(1008, "Too many invalid protocol messages");
        }
        return;
      }

      const rateKey = `${parsed.message.sessionId ?? connectionId}:${parsed.message.type}`;
      const rateBucket = rateBuckets.get(rateKey) ?? {
        windowStartedAt: Date.now(),
        count: 0,
      };
      rateBuckets.set(rateKey, rateBucket);
      const rateResult = checkWebSocketMessageRate(
        parsed.message.type,
        rateBucket,
        websocketLimits,
      );
      if (!rateResult.ok) {
        socket.send(
          JSON.stringify({
            id: nanoid(),
            type: "error",
            timestamp: Date.now(),
            payload: {
              code: "rate_limit_exceeded",
              message: "Too many WebSocket messages. Please wait before retrying.",
              retryable: true,
              limit: rateResult.limit,
              resetAt: rateResult.resetAt,
            },
          }),
        );
        return;
      }

      invalidMessageCount = 0;
      const operation = handleMessage(socket, parsed.message, context).catch((error) => {
        logger.error(
          { connectionId, error: String(error) },
          "Unhandled error in message handler",
        );
      });
      trackInFlight(inFlightMessages, operation);
    });

    socket.on("close", (code: number, reason: Buffer) => {
      logger.info(
        { connectionId, code, reason: reason.toString("utf-8") },
        "WebSocket connection closed",
      );

      // Clean up connected client entry
      for (const [clientId, client] of connectedClients) {
        if (client.ws === socket) {
          connectedClients.delete(clientId);
          logger.debug({ clientId }, "Removed disconnected client");
          break;
        }
      }
    });

    socket.on("error", (error: Error) => {
      logger.error(
        { connectionId, error: error.message },
        "WebSocket error",
      );
    });
  });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────

  const shutdown = async (signal: string): Promise<void> => {
    if (isDraining) {
      logger.info({ signal }, "Shutdown already in progress");
      return;
    }

    isDraining = true;
    logger.info(
      { signal, connections: connectedClients.size, inFlightMessages: inFlightMessages.size },
      "Received shutdown signal",
    );

    const notified = notifyClientsOfShutdown(
      connectedClients.values(),
      signal,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
    );
    logger.info({ notified }, "Sent shutdown notice to WebSocket clients");

    const drainStatus = await waitForInFlight(
      inFlightMessages,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
    );
    if (drainStatus === "timeout") {
      logger.warn(
        { remaining: inFlightMessages.size },
        "Timed out waiting for in-flight messages to complete",
      );
    }

    // Stop heartbeat scheduler
    heartbeatScheduler.stopAll();

    // Stop session manager (flushes to storage)
    await sessionManager.stop();

    const closed = closeClientsForShutdown(connectedClients);
    logger.info({ closed }, "Closed WebSocket clients for shutdown");

    // Close the server
    await server.close();

    logger.info("Gateway shut down cleanly");
    process.exit(0);
  };

  process.on("SIGINT", () => { shutdown("SIGINT").catch(() => process.exit(1)); });
  process.on("SIGTERM", () => { shutdown("SIGTERM").catch(() => process.exit(1)); });

  // ─── Start Server ───────────────────────────────────────────────────────

  try {
    await server.listen({ port, host });
    logger.info(
      { port, host, ws: `ws://${host}:${port}/ws`, health: `http://${host}:${port}/health` },
      "Karna Gateway started",
    );
  } catch (error) {
    logger.fatal({ error: String(error) }, "Failed to start gateway");
    process.exit(1);
  }
}

// ─── Process-Level Error Handlers ─────────────────────────────────────────

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason: String(reason) }, "Unhandled promise rejection");
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  logger.fatal({ error: error.message, stack: error.stack }, "Uncaught exception");
  process.exit(1);
});

main().catch((error) => {
  logger.fatal({ error: String(error) }, "Unhandled error in gateway main");
  process.exit(1);
});
