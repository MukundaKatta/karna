import type { FastifyInstance } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createLogger } from "@karna/shared";
import { authMiddleware, signAccessToken, signRefreshToken, verifyToken, type AuthUser } from "../middleware/auth.js";
import { AUTH_RATE_LIMIT_CONFIG } from "../middleware/rate-limit.js";

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

const ResetPasswordSchema = z.object({
  tokenHash: z.string().min(16, "Reset token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const DEFAULT_PASSWORD_RESET_REDIRECT_URL = "https://cloud.karna.ai/reset-password";
const PASSWORD_RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const PASSWORD_RESET_REQUEST_LIMIT = 3;
export const PASSWORD_RESET_TOKEN_TTL_SECONDS = 15 * 60;

const passwordResetRequestsByEmail = new Map<string, number[]>();

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

  server.post("/auth/register", { config: AUTH_RATE_LIMIT_CONFIG }, async (request, reply) => {
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

  server.post("/auth/login", { config: AUTH_RATE_LIMIT_CONFIG }, async (request, reply) => {
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
    } catch (error) {
      logger.warn({ error: String(error) }, "Refresh token verification failed");
      return reply.status(401).send({ error: "Invalid or expired refresh token" });
    }
  });

  // ─── POST /auth/forgot-password ──────────────────────────────────────

  server.post("/auth/forgot-password", { config: AUTH_RATE_LIMIT_CONFIG }, async (request, reply) => {
    const parseResult = ForgotPasswordSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({ error: "Valid email is required" });
    }

    const { email } = parseResult.data;
    const resetRateLimit = recordPasswordResetRequest(email);
    if (!resetRateLimit.allowed) {
      logger.warn({ email: normalizeEmail(email) }, "Password reset request rate limit exceeded");
      return reply.status(429).send({
        message: "If an account with that email exists, a password reset link has been sent.",
      });
    }

    const sb = requireSupabase();

    logger.info(
      {
        email: normalizeEmail(email),
        tokenTtlSeconds: PASSWORD_RESET_TOKEN_TTL_SECONDS,
      },
      "Password reset requested",
    );

    const redirectUrl = resolvePasswordResetRedirectUrl(process.env["PASSWORD_RESET_REDIRECT_URL"]);

    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });

    if (error) {
      logger.error({ error: error.message, email: normalizeEmail(email) }, "Failed to send password reset email");
      // Don't reveal whether the email exists
    }

    // Always return success to prevent email enumeration
    return reply.send({ message: "If an account with that email exists, a password reset link has been sent." });
  });

  // ─── POST /auth/reset-password ───────────────────────────────────────

  server.post("/auth/reset-password", { config: AUTH_RATE_LIMIT_CONFIG }, async (request, reply) => {
    const parseResult = ResetPasswordSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { tokenHash, password } = parseResult.data;
    const sb = requireSupabase();

    const { data: verifyData, error: verifyError } = await sb.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });

    if (verifyError || !verifyData.user) {
      logger.warn({ error: verifyError?.message }, "Password reset token verification failed");
      return reply.status(400).send({ error: "Invalid or expired password reset token" });
    }

    const userId = verifyData.user.id;
    const { error: updateError } = await sb.auth.admin.updateUserById(userId, { password });
    if (updateError) {
      logger.error({ error: updateError.message, userId }, "Password reset update failed");
      return reply.status(500).send({ error: "Unable to reset password" });
    }

    if (verifyData.session?.access_token) {
      const { error: signOutError } = await sb.auth.admin.signOut(verifyData.session.access_token, "global");
      if (signOutError) {
        logger.warn({ error: signOutError.message, userId }, "Failed to revoke password reset session");
      }
    }

    logger.info({ userId }, "Password reset completed");

    return reply.send({ message: "Password has been reset." });
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

export function recordPasswordResetRequest(
  email: string,
  now = Date.now(),
  store = passwordResetRequestsByEmail,
): { allowed: boolean; remaining: number; resetAt: number } {
  const key = normalizeEmail(email);
  const windowStart = now - PASSWORD_RESET_REQUEST_WINDOW_MS;
  const attempts = (store.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  const resetAt =
    attempts.length > 0 ? attempts[0]! + PASSWORD_RESET_REQUEST_WINDOW_MS : now + PASSWORD_RESET_REQUEST_WINDOW_MS;

  if (attempts.length >= PASSWORD_RESET_REQUEST_LIMIT) {
    store.set(key, attempts);
    return { allowed: false, remaining: 0, resetAt };
  }

  attempts.push(now);
  store.set(key, attempts);
  return {
    allowed: true,
    remaining: PASSWORD_RESET_REQUEST_LIMIT - attempts.length,
    resetAt: attempts[0]! + PASSWORD_RESET_REQUEST_WINDOW_MS,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function resolvePasswordResetRedirectUrl(value: string | undefined): string {
  if (!value) {
    return DEFAULT_PASSWORD_RESET_REDIRECT_URL;
  }

  try {
    const parsed = new URL(value);
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
    const protocolAllowed = parsed.protocol === "https:" || (isLocalhost && parsed.protocol === "http:");

    if (!protocolAllowed) {
      return DEFAULT_PASSWORD_RESET_REDIRECT_URL;
    }

    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";

    if (!parsed.pathname || parsed.pathname === "/") {
      parsed.pathname = "/reset-password";
    }

    return parsed.toString();
  } catch {
    return DEFAULT_PASSWORD_RESET_REDIRECT_URL;
  }
}
