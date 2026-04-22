import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import pino from "pino";
import { nanoid } from "nanoid";
import { parseMessage } from "./protocol/schema.js";
import { handleMessage, type ConnectedClient, type ConnectionContext } from "./protocol/handler.js";
import { SessionManager } from "./session/manager.js";
import { HeartbeatScheduler } from "./heartbeat/scheduler.js";
import { loadConfig } from "./config/loader.js";
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
import { join } from "node:path";
import { homedir } from "node:os";

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
  const port = Number(process.env["GATEWAY_PORT"]) || config.gateway.port;
  const host = process.env["GATEWAY_HOST"] ?? config.gateway.host;

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

  // Register WebSocket plugin
  await server.register(websocket, {
    options: {
      maxPayload: 1_048_576, // 1 MB
    },
  });

  // ─── CORS ──────────────────────────────────────────────────────────────

  const corsOrigins = process.env["CORS_ORIGINS"]?.split(",").map((o) => o.trim()).filter(Boolean)
    ?? (config.gateway.corsOrigin ? [config.gateway.corsOrigin] : undefined)
    ?? ["http://localhost:3000", "http://localhost:5173"];

  await server.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    credentials: true,
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

  server.get("/api/analytics", async (_request, reply) => {
    const sessions = sessionManager.listAllSessions();
    const metrics = metricsCollector.getMetrics();

    let totalMessages = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;

    for (const session of sessions) {
      if (session.stats) {
        totalMessages += session.stats.messageCount;
        totalInputTokens += session.stats.totalInputTokens;
        totalOutputTokens += session.stats.totalOutputTokens;
        totalCostUsd += session.stats.totalCostUsd;
      }
    }

    return reply.send({
      overview: {
        activeSessions: sessions.length,
        activeConnections: connectedClients.size,
        totalMessages,
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      },
      metrics,
      sessionsByChannel: sessions.reduce(
        (acc, s) => {
          acc[s.channelType] = (acc[s.channelType] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    });
  });

  registerMemoryRoutes(server, memoryStore);
  registerAccessRoutes(server, accessPolicies);
  registerSessionRoutes(server, sessionManager);

  // ─── WebSocket Route ────────────────────────────────────────────────────

  server.get("/ws", { websocket: true }, (socket, _request) => {
    const connectionId = nanoid();
    logger.info({ connectionId }, "WebSocket connection opened");

    const context: ConnectionContext = {
      ws: socket,
      auth: null,
      sessionManager,
      heartbeatScheduler,
      accessPolicies,
      connectedClients,
    };

    socket.on("message", (rawData: Buffer | string) => {
      const message = parseMessage(rawData as string | Buffer);

      if (!message) {
        socket.send(
          JSON.stringify({
            id: nanoid(),
            type: "error",
            timestamp: Date.now(),
            payload: {
              code: "INVALID_MESSAGE",
              message: "Failed to parse message. Ensure it conforms to the protocol schema.",
              retryable: false,
            },
          }),
        );
        return;
      }

      handleMessage(socket, message, context).catch((error) => {
        logger.error(
          { connectionId, error: String(error) },
          "Unhandled error in message handler",
        );
      });
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
    logger.info({ signal }, "Received shutdown signal");

    // Stop heartbeat scheduler
    heartbeatScheduler.stopAll();

    // Stop session manager (flushes to storage)
    await sessionManager.stop();

    // Close all WebSocket connections
    for (const [clientId, client] of connectedClients) {
      try {
        client.ws.close(1001, "Server shutting down");
      } catch {
        // Ignore errors closing connections during shutdown
      }
      connectedClients.delete(clientId);
    }

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
