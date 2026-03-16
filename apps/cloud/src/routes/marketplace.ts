import type { FastifyInstance } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createLogger } from "@karna/shared";
import { authMiddleware } from "../middleware/auth.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-cloud-routes-marketplace" });

// ─── Constants ──────────────────────────────────────────────────────────────

const DEVELOPER_REVENUE_SHARE = 0.70; // 70% to developer
const PLATFORM_REVENUE_SHARE = 0.30; // 30% to platform

// ─── Schemas ────────────────────────────────────────────────────────────────

const ListSkillsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  category: z.string().max(50).optional(),
  sort: z.enum(["popular", "newest", "rating", "price_asc", "price_desc"]).default("popular"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const PublishSkillSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(10).max(5000),
  category: z.string().min(1).max(50),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver (e.g. 1.0.0)"),
  priceCents: z.number().int().min(0).max(100000), // 0 = free skill
  sourceUrl: z.string().url().optional(),
  iconUrl: z.string().url().optional(),
  tags: z.array(z.string().max(30)).max(10).default([]),
  readme: z.string().max(50000).optional(),
});

const SkillIdParamSchema = z.object({
  id: z.string().uuid("Invalid skill ID"),
});

const SubmitReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

const ReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ─── Route Registration ─────────────────────────────────────────────────────

export async function marketplaceRoutes(server: FastifyInstance): Promise<void> {
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

  // ─── GET /marketplace/skills ──────────────────────────────────────────

  server.get("/marketplace/skills", async (request, reply) => {
    const queryResult = ListSkillsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: queryResult.error.flatten().fieldErrors,
      });
    }

    const { search, category, sort, page, limit } = queryResult.data;
    const sb = requireSupabase();
    const offset = (page - 1) * limit;

    let query = sb
      .from("published_skills")
      .select("*", { count: "exact" })
      .eq("status", "published");

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    if (category) {
      query = query.eq("category", category);
    }

    // Apply sorting
    switch (sort) {
      case "popular":
        query = query.order("downloads", { ascending: false });
        break;
      case "newest":
        query = query.order("created_at", { ascending: false });
        break;
      case "rating":
        query = query.order("rating", { ascending: false });
        break;
      case "price_asc":
        query = query.order("price_cents", { ascending: true });
        break;
      case "price_desc":
        query = query.order("price_cents", { ascending: false });
        break;
    }

    query = query.range(offset, offset + limit - 1);

    const { data: skills, count, error } = await query;

    if (error) {
      logger.error({ error: error.message }, "Failed to list marketplace skills");
      return reply.status(500).send({ error: "Failed to list skills" });
    }

    return reply.send({
      skills: skills ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    });
  });

  // ─── GET /marketplace/skills/:id ──────────────────────────────────────

  server.get("/marketplace/skills/:id", async (request, reply) => {
    const paramResult = SkillIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: "Invalid skill ID" });
    }

    const sb = requireSupabase();

    const { data: skill, error } = await sb
      .from("published_skills")
      .select("*")
      .eq("id", paramResult.data.id)
      .single();

    if (error || !skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }

    return reply.send({ skill });
  });

  // ─── POST /marketplace/skills ─────────────────────────────────────────

  server.post("/marketplace/skills", { preHandler: [authMiddleware] }, async (request, reply) => {
    const parseResult = PublishSkillSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const sb = requireSupabase();
    const data = parseResult.data;

    logger.info({ userId: user.userId, skillName: data.name }, "Publishing skill to marketplace");

    const { data: skill, error } = await sb
      .from("published_skills")
      .insert({
        developer_id: user.userId,
        name: data.name,
        description: data.description,
        category: data.category,
        version: data.version,
        price_cents: data.priceCents,
        source_url: data.sourceUrl ?? null,
        icon_url: data.iconUrl ?? null,
        tags: data.tags,
        readme: data.readme ?? null,
        downloads: 0,
        rating: 0,
        review_count: 0,
        status: "published",
      })
      .select()
      .single();

    if (error) {
      logger.error({ error: error.message }, "Failed to publish skill");
      return reply.status(500).send({ error: "Failed to publish skill" });
    }

    logger.info({ skillId: skill.id, userId: user.userId }, "Skill published");

    return reply.status(201).send({
      skill,
      revenueShare: {
        developer: `${DEVELOPER_REVENUE_SHARE * 100}%`,
        platform: `${PLATFORM_REVENUE_SHARE * 100}%`,
      },
    });
  });

  // ─── POST /marketplace/skills/:id/install ─────────────────────────────

  server.post("/marketplace/skills/:id/install", { preHandler: [authMiddleware] }, async (request, reply) => {
    const paramResult = SkillIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: "Invalid skill ID" });
    }

    const user = request.user!;
    const sb = requireSupabase();
    const skillId = paramResult.data.id;

    // Fetch skill
    const { data: skill, error: skillError } = await sb
      .from("published_skills")
      .select("*")
      .eq("id", skillId)
      .single();

    if (skillError || !skill) {
      return reply.status(404).send({ error: "Skill not found" });
    }

    logger.info({ userId: user.userId, skillId, skillName: skill.name }, "Installing skill");

    // If paid skill, record purchase
    if (skill.price_cents > 0) {
      // Check if already purchased
      const { data: existing } = await sb
        .from("skill_purchases")
        .select("id")
        .eq("user_id", user.userId)
        .eq("skill_id", skillId)
        .single();

      if (!existing) {
        const developerEarnings = Math.floor(skill.price_cents * DEVELOPER_REVENUE_SHARE);
        const platformEarnings = skill.price_cents - developerEarnings;

        const { error: purchaseError } = await sb
          .from("skill_purchases")
          .insert({
            user_id: user.userId,
            skill_id: skillId,
            price_paid: skill.price_cents,
            developer_earnings: developerEarnings,
            platform_earnings: platformEarnings,
          });

        if (purchaseError) {
          logger.error({ error: purchaseError.message }, "Failed to record skill purchase");
          return reply.status(500).send({ error: "Failed to process purchase" });
        }
      }
    }

    // Increment download count
    try {
      await sb.rpc("increment_skill_downloads", { skill_id: skillId });
    } catch (err: unknown) {
      logger.warn({ error: (err as Error).message, skillId }, "Failed to increment download count");
    }

    return reply.send({
      installed: true,
      skill: { id: skill.id, name: skill.name, version: skill.version },
    });
  });

  // ─── POST /marketplace/skills/:id/review ──────────────────────────────

  server.post("/marketplace/skills/:id/review", { preHandler: [authMiddleware] }, async (request, reply) => {
    const paramResult = SkillIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: "Invalid skill ID" });
    }

    const parseResult = SubmitReviewSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const sb = requireSupabase();
    const skillId = paramResult.data.id;
    const { rating, comment } = parseResult.data;

    // Check if user already reviewed this skill
    const { data: existingReview } = await sb
      .from("skill_reviews")
      .select("id")
      .eq("user_id", user.userId)
      .eq("skill_id", skillId)
      .single();

    if (existingReview) {
      // Update existing review
      const { error } = await sb
        .from("skill_reviews")
        .update({ rating, comment: comment ?? null, updated_at: new Date().toISOString() })
        .eq("id", existingReview.id);

      if (error) {
        logger.error({ error: error.message }, "Failed to update review");
        return reply.status(500).send({ error: "Failed to update review" });
      }

      logger.info({ skillId, userId: user.userId, rating }, "Review updated");
    } else {
      // Create new review
      const { error } = await sb
        .from("skill_reviews")
        .insert({
          user_id: user.userId,
          skill_id: skillId,
          rating,
          comment: comment ?? null,
        });

      if (error) {
        logger.error({ error: error.message }, "Failed to create review");
        return reply.status(500).send({ error: "Failed to submit review" });
      }

      logger.info({ skillId, userId: user.userId, rating }, "Review submitted");
    }

    // Update skill average rating
    const { data: reviews } = await sb
      .from("skill_reviews")
      .select("rating")
      .eq("skill_id", skillId);

    if (reviews && reviews.length > 0) {
      const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
      await sb
        .from("published_skills")
        .update({ rating: Math.round(avgRating * 10) / 10, review_count: reviews.length })
        .eq("id", skillId);
    }

    return reply.send({ message: "Review submitted successfully" });
  });

  // ─── GET /marketplace/skills/:id/reviews ──────────────────────────────

  server.get("/marketplace/skills/:id/reviews", async (request, reply) => {
    const paramResult = SkillIdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({ error: "Invalid skill ID" });
    }

    const queryResult = ReviewsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: queryResult.error.flatten().fieldErrors,
      });
    }

    const sb = requireSupabase();
    const { page, limit } = queryResult.data;
    const offset = (page - 1) * limit;

    const { data: reviews, count, error } = await sb
      .from("skill_reviews")
      .select("*", { count: "exact" })
      .eq("skill_id", paramResult.data.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error({ error: error.message }, "Failed to list reviews");
      return reply.status(500).send({ error: "Failed to list reviews" });
    }

    return reply.send({
      reviews: reviews ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limit),
      },
    });
  });
}
