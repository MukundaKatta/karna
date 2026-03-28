import Fastify from "fastify";
import cors from "@fastify/cors";
import { createLogger } from "@karna/shared";
import { nanoid } from "nanoid";
import { authRoutes } from "./routes/auth.js";
import { agentRoutes } from "./routes/agents.js";
import { subscriptionRoutes } from "./routes/subscriptions.js";
import { usageRoutes } from "./routes/usage.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { marketplaceRoutes } from "./routes/marketplace.js";
import { registerRateLimit } from "./middleware/rate-limit.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-cloud" });

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const port = Number(process.env["CLOUD_PORT"]) || 3100;
  const host = process.env["CLOUD_HOST"] ?? "0.0.0.0";

  // ─── Create Fastify Server ──────────────────────────────────────────

  const server = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? "info",
    },
    genReqId: () => nanoid(),
    bodyLimit: 1_048_576, // 1 MB
  });

  // ─── CORS ─────────────────────────────────────────────────────────────

  await server.register(cors, {
    origin: process.env["CORS_ORIGINS"]?.split(",") ?? [
      "http://localhost:3000",
      "http://localhost:5173",
      "https://cloud.karna.ai",
      "https://app.karna.ai",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Channel"],
    credentials: true,
  });

  // ─── Rate Limiting ────────────────────────────────────────────────────

  await registerRateLimit(server);

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

  // ─── Health Endpoint ──────────────────────────────────────────────────

  server.get("/health", async (_request, reply) => {
    return reply.send({
      status: "healthy",
      service: "karna-cloud",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Register Routes ─────────────────────────────────────────────────

  await server.register(authRoutes);
  await server.register(agentRoutes, { prefix: "" });
  await server.register(subscriptionRoutes);
  await server.register(usageRoutes);
  await server.register(apiKeyRoutes);
  await server.register(marketplaceRoutes);

  // ─── Global Error Handler ─────────────────────────────────────────────

  server.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      logger.error({ error: error.message, stack: error.stack }, "Internal server error");
    }

    return reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal Server Error" : error.message,
      statusCode,
    });
  });

  // ─── Graceful Shutdown ────────────────────────────────────────────────

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Received shutdown signal");
    await server.close();
    logger.info("Karna Cloud API shut down cleanly");
    process.exit(0);
  };

  process.on("SIGINT", () => { shutdown("SIGINT").catch(() => process.exit(1)); });
  process.on("SIGTERM", () => { shutdown("SIGTERM").catch(() => process.exit(1)); });

  // ─── Start Server ────────────────────────────────────────────────────

  try {
    await server.listen({ port, host });
    logger.info(
      {
        port,
        host,
        health: `http://${host}:${port}/health`,
        api: `http://${host}:${port}`,
      },
      "Karna Cloud API started",
    );
  } catch (error) {
    logger.fatal({ error: String(error) }, "Failed to start Karna Cloud API");
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
  logger.fatal({ error: String(error) }, "Unhandled error in Karna Cloud main");
  process.exit(1);
});
