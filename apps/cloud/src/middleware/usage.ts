import type { FastifyRequest, FastifyReply } from "fastify";
import { createLogger } from "@karna/shared";
import { UsageMeter, type PlanId } from "@karna/payments";
import type { AuthUser } from "./auth.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-cloud-usage" });

// ─── Shared Usage Meter Instance ────────────────────────────────────────────

let usageMeterInstance: UsageMeter | null = null;

export function getUsageMeter(): UsageMeter {
  if (!usageMeterInstance) {
    usageMeterInstance = new UsageMeter();
  }
  return usageMeterInstance;
}

export function setUsageMeter(meter: UsageMeter): void {
  usageMeterInstance = meter;
}

// ─── Usage Tracking Middleware ──────────────────────────────────────────────

/**
 * Middleware that tracks message usage and enforces plan limits.
 * Attach to routes that count as "messages" (e.g., agent chat endpoints).
 */
export function createUsageMiddleware(getAgentId: (request: FastifyRequest) => string | null) {
  return async function usageMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = request.user as AuthUser | undefined;
    if (!user) {
      return; // Auth middleware should have already rejected
    }

    const agentId = getAgentId(request);
    if (!agentId) {
      return; // No agent context, skip usage tracking
    }

    const meter = getUsageMeter();
    const plan = user.plan as PlanId;

    try {
      const limits = await meter.checkLimits(agentId, plan);

      if (!limits.allowed) {
        logger.warn(
          { userId: user.userId, agentId, plan, used: limits.used, limit: limits.limit },
          "Usage limit exceeded",
        );

        return reply.status(429).send({
          error: "Usage limit exceeded",
          message: `You have used ${limits.used} of ${limits.limit} messages for this billing period.`,
          used: limits.used,
          limit: limits.limit,
          resetAt: limits.resetAt.toISOString(),
          upgradeUrl: "/subscriptions/plans",
        });
      }

      // Track the message
      const channel = (request.headers["x-channel"] as string) ?? "api";
      await meter.trackMessage(agentId, channel);

      // Attach remaining count to response headers
      reply.header("X-Usage-Remaining", String(limits.remaining - 1));
      reply.header("X-Usage-Limit", String(limits.limit));
      reply.header("X-Usage-Reset", limits.resetAt.toISOString());
    } catch (error) {
      logger.error({ error: String(error), agentId }, "Failed to check usage limits");
      // Don't block the request on usage tracking failure
    }
  };
}
