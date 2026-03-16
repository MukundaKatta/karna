import type { FastifyInstance } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { createLogger } from "@karna/shared";
import { PLANS, type PlanId } from "@karna/payments";
import { authMiddleware } from "../middleware/auth.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-cloud-routes-apikeys" });

// ─── Schemas ────────────────────────────────────────────────────────────────

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).default(["read", "write"]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const ApiKeyIdParamSchema = z.object({
  id: z.string().uuid("Invalid API key ID"),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateApiKey(): string {
  const prefix = "karna_";
  const key = randomBytes(32).toString("base64url");
  return `${prefix}${key}`;
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// ─── Route Registration ─────────────────────────────────────────────────────

export async function apiKeyRoutes(server: FastifyInstance): Promise<void> {
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

  // ─── POST /api-keys ──────────────────────────────────────────────────

  server.post("/api-keys", async (request, reply) => {
    const parseResult = CreateApiKeySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const plan = user.plan as PlanId;
    const planConfig = PLANS[plan] ?? PLANS.free;

    // Only team plan has API access
    if (!planConfig.api) {
      return reply.status(403).send({
        error: "API key access requires the Team plan",
        message: "Upgrade to the Karna Cloud Team plan to use API keys.",
        upgradeUrl: "/subscriptions/plans",
      });
    }

    const sb = requireSupabase();
    const { name, permissions, expiresInDays } = parseResult.data;

    // Check existing API key count (limit to 10 per user)
    const { count, error: countError } = await sb
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.userId)
      .is("revoked_at", null);

    if (countError) {
      logger.error({ error: countError.message }, "Failed to count API keys");
      return reply.status(500).send({ error: "Failed to check API key limits" });
    }

    if ((count ?? 0) >= 10) {
      return reply.status(400).send({ error: "Maximum of 10 active API keys allowed" });
    }

    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);

    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    logger.info({ userId: user.userId, keyName: name }, "Creating API key");

    const { data: apiKey, error } = await sb
      .from("api_keys")
      .insert({
        user_id: user.userId,
        name,
        key_hash: keyHash,
        key_prefix: rawKey.substring(0, 12),
        permissions,
        expires_at: expiresAt,
      })
      .select("id, name, key_prefix, permissions, expires_at, created_at")
      .single();

    if (error) {
      logger.error({ error: error.message }, "Failed to create API key");
      return reply.status(500).send({ error: "Failed to create API key" });
    }

    logger.info({ apiKeyId: apiKey.id, userId: user.userId }, "API key created");

    // Return the raw key ONLY once — it cannot be retrieved again
    return reply.status(201).send({
      apiKey: {
        ...apiKey,
        key: rawKey,
      },
      warning: "Store this API key securely. It will not be shown again.",
    });
  });

  // ─── GET /api-keys ───────────────────────────────────────────────────

  server.get("/api-keys", async (request, reply) => {
    const user = request.user!;
    const sb = requireSupabase();

    const { data: keys, error } = await sb
      .from("api_keys")
      .select("id, name, key_prefix, permissions, last_used_at, expires_at, created_at")
      .eq("user_id", user.userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      logger.error({ error: error.message }, "Failed to list API keys");
      return reply.status(500).send({ error: "Failed to list API keys" });
    }

    return reply.send({
      apiKeys: (keys ?? []).map((key) => ({
        ...key,
        isExpired: key.expires_at ? new Date(key.expires_at) < new Date() : false,
      })),
    });
  });

  // ─── DELETE /api-keys/:id ─────────────────────────────────────────────

  server.delete("/api-keys/:id", async (request, reply) => {
    const paramResult = ApiKeyIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: "Invalid API key ID" });
    }

    const user = request.user!;
    const sb = requireSupabase();

    logger.info({ apiKeyId: paramResult.data.id, userId: user.userId }, "Revoking API key");

    const { error } = await sb
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", paramResult.data.id)
      .eq("user_id", user.userId);

    if (error) {
      logger.error({ error: error.message }, "Failed to revoke API key");
      return reply.status(500).send({ error: "Failed to revoke API key" });
    }

    return reply.status(204).send();
  });
}
