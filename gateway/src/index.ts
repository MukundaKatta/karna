import Fastify from "fastify";
import websocket from "@fastify/websocket";
import pino from "pino";
import { nanoid } from "nanoid";
import { parseMessage } from "./protocol/schema.js";
import { handleMessage, type ConnectedClient, type ConnectionContext } from "./protocol/handler.js";
import { SessionManager } from "./session/manager.js";
import { HeartbeatScheduler } from "./heartbeat/scheduler.js";
import { loadConfig } from "./config/loader.js";
import { getSystemHealth, setConnectionCounter, setSessionCounter } from "./health/status.js";
import { MetricsCollector } from "./health/metrics.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = pino({
  name: "karna-gateway",
  level: process.env["LOG_LEVEL"] ?? "info",
});

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
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

  // ─── WebSocket Route ────────────────────────────────────────────────────

  server.get("/ws", { websocket: true }, (socket, _request) => {
    const connectionId = nanoid();
    logger.info({ connectionId }, "WebSocket connection opened");

    const context: ConnectionContext = {
      ws: socket,
      auth: null,
      sessionManager,
      heartbeatScheduler,
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

main().catch((error) => {
  logger.fatal({ error: String(error) }, "Unhandled error in gateway main");
  process.exit(1);
});
