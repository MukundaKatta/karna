import type { FastifyInstance } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createLogger } from "@karna/shared";
import { authMiddleware, signAccessToken, signRefreshToken, verifyToken, type AuthUser } from "../middleware/auth.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-cloud-routes-auth" });

// ─── Schemas ────────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(100),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

// ─── Route Registration ─────────────────────────────────────────────────────

export async function authRoutes(server: FastifyInstance): Promise<void> {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseServiceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  if (!supabaseUrl || !supabaseServiceKey) {
    logger.warn("Supabase credentials not configured; auth routes will return 503");
  }

  const supabase: SupabaseClient | null =
    supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

  function requireSupabase(): SupabaseClient {
    if (!supabase) {
      throw { statusCode: 503, message: "Authentication service is not configured" };
    }
    return supabase;
  }

  // ─── POST /auth/register ──────────────────────────────────────────────

  server.post("/auth/register", async (request, reply) => {
    const parseResult = RegisterSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { email, password, name } = parseResult.data;
    const sb = requireSupabase();

    logger.info({ email }, "Registering new user");

    // Create user in Supabase Auth
    const { data: authData, error: authError } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (authError) {
      logger.error({ error: authError.message }, "Failed to create user in Supabase Auth");
      return reply.status(400).send({ error: authError.message });
    }

    const userId = authData.user.id;

    // Create cloud user profile
    const { error: profileError } = await sb
      .from("cloud_users")
      .insert({
        user_id: userId,
        email,
        name,
        plan: "free",
        usage_reset_at: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
      });

    if (profileError) {
      logger.error({ error: profileError.message, userId }, "Failed to create user profile");
      // Don't fail the registration; the profile can be created later
    }

    const authUser: AuthUser = {
      userId,
      email,
      plan: "free",
      stripeCustomerId: null,
      razorpayCustomerId: null,
    };

    const accessToken = signAccessToken(authUser);
    const refreshToken = signRefreshToken(userId);

    logger.info({ userId }, "User registered successfully");

    return reply.status(201).send({
      user: { id: userId, email, name, plan: "free" },
      accessToken,
      refreshToken,
    });
  });

  // ─── POST /auth/login ────────────────────────────────────────────────

  server.post("/auth/login", async (request, reply) => {
    const parseResult = LoginSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { email, password } = parseResult.data;
    const sb = requireSupabase();

    logger.info({ email }, "User login attempt");

    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      logger.warn({ email, error: error?.message }, "Login failed");
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    // Fetch cloud user profile
    const { data: profile } = await sb
      .from("cloud_users")
      .select("*")
      .eq("user_id", data.user.id)
      .single();

    const authUser: AuthUser = {
      userId: data.user.id,
      email: data.user.email ?? email,
      plan: profile?.plan ?? "free",
      stripeCustomerId: profile?.stripe_customer_id ?? null,
      razorpayCustomerId: profile?.razorpay_customer_id ?? null,
    };

    const accessToken = signAccessToken(authUser);
    const refreshToken = signRefreshToken(data.user.id);

    logger.info({ userId: data.user.id }, "User logged in successfully");

    return reply.send({
      user: {
        id: data.user.id,
        email: authUser.email,
        name: profile?.name ?? data.user.user_metadata?.name ?? "",
        plan: authUser.plan,
      },
      accessToken,
      refreshToken,
    });
  });

  // ─── POST /auth/refresh ──────────────────────────────────────────────

  server.post("/auth/refresh", async (request, reply) => {
    const parseResult = RefreshSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: "Refresh token is required" });
    }

    const { refreshToken } = parseResult.data;

    try {
      const decoded = verifyToken(refreshToken);

      if (decoded["type"] !== "refresh") {
        return reply.status(401).send({ error: "Invalid token type" });
      }

      const userId = decoded["sub"] as string;
      const sb = requireSupabase();

      // Fetch current user profile
      const { data: profile } = await sb
        .from("cloud_users")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (!profile) {
        return reply.status(401).send({ error: "User not found" });
      }

      const authUser: AuthUser = {
        userId,
        email: profile.email,
        plan: profile.plan ?? "free",
        stripeCustomerId: profile.stripe_customer_id ?? null,
        razorpayCustomerId: profile.razorpay_customer_id ?? null,
      };

      const newAccessToken = signAccessToken(authUser);
      const newRefreshToken = signRefreshToken(userId);

      return reply.send({ accessToken: newAccessToken, refreshToken: newRefreshToken });
    } catch {
      return reply.status(401).send({ error: "Invalid or expired refresh token" });
    }
  });

  // ─── POST /auth/forgot-password ──────────────────────────────────────

  server.post("/auth/forgot-password", async (request, reply) => {
    const parseResult = ForgotPasswordSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: "Valid email is required" });
    }

    const { email } = parseResult.data;
    const sb = requireSupabase();

    logger.info({ email }, "Password reset requested");

    const redirectUrl = process.env["PASSWORD_RESET_REDIRECT_URL"] ?? "https://cloud.karna.ai/reset-password";

    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });

    if (error) {
      logger.error({ error: error.message }, "Failed to send password reset email");
      // Don't reveal whether the email exists
    }

    // Always return success to prevent email enumeration
    return reply.send({ message: "If an account with that email exists, a password reset link has been sent." });
  });

  // ─── GET /auth/me ────────────────────────────────────────────────────

  server.get("/auth/me", { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = request.user!;
    const sb = requireSupabase();

    const { data: profile } = await sb
      .from("cloud_users")
      .select("*")
      .eq("user_id", user.userId)
      .single();

    return reply.send({
      id: user.userId,
      email: user.email,
      name: profile?.name ?? "",
      plan: user.plan,
      stripeCustomerId: user.stripeCustomerId,
      razorpayCustomerId: user.razorpayCustomerId,
      usageResetAt: profile?.usage_reset_at ?? null,
      createdAt: profile?.created_at ?? null,
    });
  });
}
