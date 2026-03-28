import type { FastifyInstance, FastifyRequest } from "fastify";
import { createLogger } from "@karna/shared";
import type { AuthUser } from "./auth.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-cloud-ratelimit" });

// ─── Plan-based Rate Limits ─────────────────────────────────────────────────

const RATE_LIMITS: Record<string, { max: number; timeWindow: string }> = {
  free: { max: 30, timeWindow: "1 minute" },
  basic: { max: 100, timeWindow: "1 minute" },
  pro: { max: 300, timeWindow: "1 minute" },
  team: { max: 1000, timeWindow: "1 minute" },
};

const DEFAULT_LIMIT = RATE_LIMITS["free"]!;

// ─── Rate Limit Configuration ───────────────────────────────────────────────

export function getRateLimitForPlan(plan: string): { max: number; timeWindow: string } {
  return RATE_LIMITS[plan] ?? DEFAULT_LIMIT;
}

// ─── Register Rate Limiting Plugin ──────────────────────────────────────────

export async function registerRateLimit(server: FastifyInstance): Promise<void> {
  const rateLimitModule = await import("@fastify/rate-limit");
  const rateLimit = rateLimitModule.default ?? rateLimitModule;

  await server.register(rateLimit, {
    global: true,
    max: (request: FastifyRequest, _key: string) => {
      const user = request.user as AuthUser | undefined;
      const plan = user?.plan ?? "free";
      const limit = getRateLimitForPlan(plan);
      return limit.max;
    },
    timeWindow: "1 minute",
    keyGenerator: (request: FastifyRequest) => {
      const user = request.user as AuthUser | undefined;
      return user?.userId ?? request.ip;
    },
    errorResponseBuilder: (_request: FastifyRequest, context: { max: number; after: string }) => {
      return {
        error: "Rate limit exceeded",
        message: `You have exceeded the ${context.max} requests per minute limit. Please retry after ${context.after}.`,
        statusCode: 429,
      };
    },
    onExceeded: (request: FastifyRequest) => {
      const user = request.user as AuthUser | undefined;
      logger.warn(
        { userId: user?.userId, plan: user?.plan, ip: request.ip, path: request.url },
        "Rate limit exceeded",
      );
    },
  });

  logger.info("Plan-based rate limiting registered");
}

// ─── Auth Rate Limit Config ──────────────────────────────────────────────
// Apply to auth routes via routeConfig in route options.

export const AUTH_RATE_LIMIT_CONFIG = {
  rateLimit: {
    max: 10,
    timeWindow: "1 minute",
    keyGenerator: (request: FastifyRequest) => request.ip,
  },
};
