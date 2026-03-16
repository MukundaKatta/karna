import type { FastifyInstance, FastifyRequest } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createLogger } from "@karna/shared";
import { PLANS, type PlanId } from "@karna/payments";
import { authMiddleware } from "../middleware/auth.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-cloud-routes-agents" });

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  persona: z.string().max(2000).optional(),
  systemPrompt: z.string().max(10000).optional(),
  modelPrimary: z.string().default("claude-sonnet-4-6"),
  modelFallback: z.string().default("claude-haiku-4-5"),
  sandboxMode: z.boolean().default(true),
});

const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  persona: z.string().max(2000).optional(),
  systemPrompt: z.string().max(10000).optional(),
  modelPrimary: z.string().optional(),
  modelFallback: z.string().optional(),
  sandboxMode: z.boolean().optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
});

const AgentIdParamSchema = z.object({
  id: z.string().uuid("Invalid agent ID"),
});

// ─── Route Registration ─────────────────────────────────────────────────────

export async function agentRoutes(server: FastifyInstance): Promise<void> {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseServiceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  const supabase: SupabaseClient | null =
    supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

  function requireSupabase(): SupabaseClient {
    if (!supabase) {
      throw { statusCode: 503, message: "Database service is not configured" };
    }
    return supabase;
  }

  // All routes require authentication
  server.addHook("preHandler", authMiddleware);

  // ─── POST /agents ─────────────────────────────────────────────────────

  server.post("/agents", async (request, reply) => {
    const parseResult = CreateAgentSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const sb = requireSupabase();
    const plan = user.plan as PlanId;
    const planConfig = PLANS[plan] ?? PLANS.free;

    // Check agent limit
    const { count, error: countError } = await sb
      .from("agents")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.userId)
      .neq("status", "archived");

    if (countError) {
      logger.error({ error: countError.message }, "Failed to count user agents");
      return reply.status(500).send({ error: "Failed to check agent limits" });
    }

    const currentAgents = count ?? 0;
    if (currentAgents >= planConfig.agents) {
      logger.warn(
        { userId: user.userId, plan, currentAgents, limit: planConfig.agents },
        "Agent limit reached",
      );
      return reply.status(403).send({
        error: "Agent limit reached",
        message: `Your ${planConfig.name} plan allows up to ${planConfig.agents} agent(s). Upgrade to create more.`,
        current: currentAgents,
        limit: planConfig.agents,
        upgradeUrl: "/subscriptions/plans",
      });
    }

    const data = parseResult.data;

    logger.info({ userId: user.userId, agentName: data.name }, "Creating agent");

    const { data: agent, error } = await sb
      .from("agents")
      .insert({
        name: data.name,
        persona: data.persona ?? null,
        system_prompt: data.systemPrompt ?? null,
        model_primary: data.modelPrimary,
        model_fallback: data.modelFallback,
        sandbox_mode: data.sandboxMode,
        owner_id: user.userId,
        status: "active",
      })
      .select()
      .single();

    if (error) {
      logger.error({ error: error.message }, "Failed to create agent");
      return reply.status(500).send({ error: "Failed to create agent" });
    }

    logger.info({ agentId: agent.id, userId: user.userId }, "Agent created");

    return reply.status(201).send({ agent });
  });

  // ─── GET /agents ──────────────────────────────────────────────────────

  server.get("/agents", async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply) => {
    const user = request.user!;
    const sb = requireSupabase();
    const status = (request.query as Record<string, string>).status;

    let query = sb
      .from("agents")
      .select("*")
      .eq("owner_id", user.userId)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data: agents, error } = await query;

    if (error) {
      logger.error({ error: error.message }, "Failed to list agents");
      return reply.status(500).send({ error: "Failed to list agents" });
    }

    return reply.send({ agents: agents ?? [] });
  });

  // ─── GET /agents/:id ─────────────────────────────────────────────────

  server.get("/agents/:id", async (request, reply) => {
    const paramResult = AgentIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: "Invalid agent ID" });
    }

    const user = request.user!;
    const sb = requireSupabase();

    const { data: agent, error } = await sb
      .from("agents")
      .select("*")
      .eq("id", paramResult.data.id)
      .eq("owner_id", user.userId)
      .single();

    if (error || !agent) {
      return reply.status(404).send({ error: "Agent not found" });
    }

    return reply.send({ agent });
  });

  // ─── PATCH /agents/:id ───────────────────────────────────────────────

  server.patch("/agents/:id", async (request, reply) => {
    const paramResult = AgentIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: "Invalid agent ID" });
    }

    const parseResult = UpdateAgentSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const sb = requireSupabase();
    const updates = parseResult.data;

    // Build update object with snake_case keys
    const updateObj: Record<string, unknown> = {};
    if (updates.name !== undefined) updateObj["name"] = updates.name;
    if (updates.persona !== undefined) updateObj["persona"] = updates.persona;
    if (updates.systemPrompt !== undefined) updateObj["system_prompt"] = updates.systemPrompt;
    if (updates.modelPrimary !== undefined) updateObj["model_primary"] = updates.modelPrimary;
    if (updates.modelFallback !== undefined) updateObj["model_fallback"] = updates.modelFallback;
    if (updates.sandboxMode !== undefined) updateObj["sandbox_mode"] = updates.sandboxMode;
    if (updates.status !== undefined) updateObj["status"] = updates.status;

    if (Object.keys(updateObj).length === 0) {
      return reply.status(400).send({ error: "No update fields provided" });
    }

    logger.info({ agentId: paramResult.data.id, userId: user.userId }, "Updating agent");

    const { data: agent, error } = await sb
      .from("agents")
      .update(updateObj)
      .eq("id", paramResult.data.id)
      .eq("owner_id", user.userId)
      .select()
      .single();

    if (error || !agent) {
      return reply.status(404).send({ error: "Agent not found or update failed" });
    }

    return reply.send({ agent });
  });

  // ─── DELETE /agents/:id ───────────────────────────────────────────────

  server.delete("/agents/:id", async (request, reply) => {
    const paramResult = AgentIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: "Invalid agent ID" });
    }

    const user = request.user!;
    const sb = requireSupabase();

    logger.info({ agentId: paramResult.data.id, userId: user.userId }, "Deleting agent (archiving)");

    // Soft delete by setting status to archived
    const { error } = await sb
      .from("agents")
      .update({ status: "archived" })
      .eq("id", paramResult.data.id)
      .eq("owner_id", user.userId);

    if (error) {
      logger.error({ error: error.message }, "Failed to delete agent");
      return reply.status(500).send({ error: "Failed to delete agent" });
    }

    return reply.status(204).send();
  });
}
