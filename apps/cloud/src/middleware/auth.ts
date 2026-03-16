import type { FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { createLogger } from "@karna/shared";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-cloud-auth" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthUser {
  userId: string;
  email: string;
  plan: string;
  stripeCustomerId: string | null;
  razorpayCustomerId: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

// ─── JWT Configuration ──────────────────────────────────────────────────────

const JWT_SECRET = process.env["JWT_SECRET"] ?? "karna-cloud-dev-secret-change-me";
const JWT_ISSUER = "karna-cloud";
const JWT_EXPIRY = "24h";
const JWT_REFRESH_EXPIRY = "7d";

// ─── Token Utilities ────────────────────────────────────────────────────────

export function signAccessToken(payload: AuthUser): string {
  return jwt.sign(
    {
      sub: payload.userId,
      email: payload.email,
      plan: payload.plan,
      stripeCustomerId: payload.stripeCustomerId,
      razorpayCustomerId: payload.razorpayCustomerId,
    },
    JWT_SECRET,
    { issuer: JWT_ISSUER, expiresIn: JWT_EXPIRY },
  );
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: "refresh" }, JWT_SECRET, {
    issuer: JWT_ISSUER,
    expiresIn: JWT_REFRESH_EXPIRY,
  });
}

export function verifyToken(token: string): jwt.JwtPayload {
  return jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER }) as jwt.JwtPayload;
}

// ─── Auth Middleware ────────────────────────────────────────────────────────

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    logger.debug({ path: request.url }, "Missing authorization header");
    return reply.status(401).send({ error: "Authorization header is required" });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return reply.status(401).send({ error: "Invalid authorization format. Use: Bearer <token>" });
  }

  const token = parts[1]!;

  try {
    const decoded = verifyToken(token);

    request.user = {
      userId: decoded["sub"] as string,
      email: decoded["email"] as string,
      plan: decoded["plan"] as string,
      stripeCustomerId: (decoded["stripeCustomerId"] as string) ?? null,
      razorpayCustomerId: (decoded["razorpayCustomerId"] as string) ?? null,
    };

    logger.debug({ userId: request.user.userId, plan: request.user.plan }, "Request authenticated");
  } catch (error) {
    const message = error instanceof jwt.TokenExpiredError ? "Token expired" : "Invalid token";
    logger.debug({ error: String(error) }, "Authentication failed");
    return reply.status(401).send({ error: message });
  }
}

// ─── API Key Auth Middleware ────────────────────────────────────────────────

export async function apiKeyMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = request.headers["x-api-key"] as string | undefined;

  if (!apiKey) {
    // Fall through to JWT auth
    return authMiddleware(request, reply);
  }

  // API key validation will be handled by the route handler
  // This middleware just extracts the key and sets a flag
  (request as FastifyRequest & { apiKey?: string }).apiKey = apiKey;
}
