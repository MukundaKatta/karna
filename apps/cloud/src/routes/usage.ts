import type { FastifyInstance } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createLogger } from "@karna/shared";
import { type PlanId, PLANS } from "@karna/payments";
import { authMiddleware } from "../middleware/auth.js";
import { getUsageMeter } from "../middleware/usage.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-cloud-routes-usage" });

// ─── Schemas ────────────────────────────────────────────────────────────────

const UsageQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  period: z.enum(["daily", "monthly"]).default("monthly"),
});

const UsageHistoryQuerySchema = z.object({
  agentId: z.string().uuid().optional(),
  months: z.coerce.number().int().min(1).max(12).default(3),
});

// ─── Route Registration ─────────────────────────────────────────────────────

export async function usageRoutes(server: FastifyInstance): Promise<void> {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseServiceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  const supabase: SupabaseClient | null =
    supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

  // All routes require authentication
  server.addHook("preHandler", authMiddleware);

  // ─── GET /usage ───────────────────────────────────────────────────────

  server.get("/usage", async (request, reply) => {
    const queryResult = UsageQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: queryResult.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const { agentId, period } = queryResult.data;
    const meter = getUsageMeter();
    const plan = user.plan as PlanId;
    const planConfig = PLANS[plan] ?? PLANS.free;

    logger.debug({ userId: user.userId, agentId, period }, "Fetching usage");

    if (agentId) {
      // Single agent usage
      const usage = await meter.getUsage(agentId, period);
      const limits = await meter.checkLimits(agentId, plan);

      return reply.send({
        usage,
        limits: {
          messagesPerMonth: planConfig.messagesPerMonth,
          used: limits.used,
          remaining: limits.remaining,
          resetAt: limits.resetAt.toISOString(),
        },
        plan: { id: plan, name: planConfig.name },
      });
    }

    // If no agentId, list all agents and aggregate usage
    if (supabase) {
      const { data: agents } = await supabase
        .from("agents")
        .select("id, name")
        .eq("owner_id", user.userId)
        .neq("status", "archived");

      const agentUsages = await Promise.all(
        (agents ?? []).map(async (agent: { id: string; name: string }) => {
          const usage = await meter.getUsage(agent.id, period);
          return { ...usage, agentId: agent.id, agentName: agent.name };
        }),
      );

      const totalMessages = agentUsages.reduce((sum, u) => sum + u.totalMessages, 0);
      const totalTokensIn = agentUsages.reduce((sum, u) => sum + u.totalTokensIn, 0);
      const totalTokensOut = agentUsages.reduce((sum, u) => sum + u.totalTokensOut, 0);

      return reply.send({
        totalMessages,
        totalTokensIn,
        totalTokensOut,
        agents: agentUsages,
        plan: { id: plan, name: planConfig.name },
        limits: {
          messagesPerMonth: planConfig.messagesPerMonth,
        },
      });
    }

    return reply.send({
      totalMessages: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      agents: [],
      plan: { id: plan, name: planConfig.name },
    });
  });

  // ─── GET /usage/history ───────────────────────────────────────────────

  server.get("/usage/history", async (request, reply) => {
    const queryResult = UsageHistoryQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: queryResult.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const { agentId, months } = queryResult.data;

    logger.debug({ userId: user.userId, agentId, months }, "Fetching usage history");

    if (!supabase) {
      return reply.send({ history: [] });
    }

    // Fetch from usage_daily table
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    const startDateStr = startDate.toISOString().split("T")[0];

    let query = supabase
      .from("usage_daily")
      .select("*")
      .eq("user_id", user.userId)
      .gte("date", startDateStr)
      .order("date", { ascending: false });

    if (agentId) {
      query = query.eq("agent_id", agentId);
    }

    const { data: history, error } = await query;

    if (error) {
      logger.error({ error: error.message }, "Failed to fetch usage history");
      return reply.status(500).send({ error: "Failed to fetch usage history" });
    }

    // Aggregate by month
    const monthlyAggregates = new Map<string, { messages: number; tokensIn: number; tokensOut: number; costCents: number }>();

    for (const row of history ?? []) {
      const monthKey = (row.date as string).substring(0, 7); // YYYY-MM
      const existing = monthlyAggregates.get(monthKey) ?? { messages: 0, tokensIn: 0, tokensOut: 0, costCents: 0 };
      existing.messages += row.messages ?? 0;
      existing.tokensIn += row.tokens_in ?? 0;
      existing.tokensOut += row.tokens_out ?? 0;
      existing.costCents += row.cost_cents ?? 0;
      monthlyAggregates.set(monthKey, existing);
    }

    const monthlyHistory = Array.from(monthlyAggregates.entries()).map(([month, data]) => ({
      month,
      ...data,
    }));

    return reply.send({
      history: monthlyHistory,
      daily: history ?? [],
    });
  });
}
