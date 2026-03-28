// ─── Security Middleware ──────────────────────────────────────────────────
//
// Security headers, CORS enforcement, and request validation
// for the Karna Gateway.
//
// ──────────────────────────────────────────────────────────────────────────

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import pino from "pino";

const logger = pino({ name: "security" });

/**
 * Rate limiter using a sliding window counter.
 */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 100, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Cleanup expired windows every minute
    const timer = setInterval(() => this.cleanup(), 60000);
    timer.unref();
  }

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    let window = this.windows.get(key);

    if (!window || now >= window.resetAt) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }

    window.count++;

    return {
      allowed: window.count <= this.maxRequests,
      remaining: Math.max(0, this.maxRequests - window.count),
      resetAt: window.resetAt,
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) this.windows.delete(key);
    }
  }
}

const rateLimiter = new RateLimiter(100, 60000); // 100 req/min

/**
 * Register security middleware on the Fastify instance.
 */
export function registerSecurityMiddleware(app: FastifyInstance): void {
  // Security headers
  app.addHook("onSend", async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "0");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws: wss:;"
    );

    if (process.env.NODE_ENV === "production") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  });

  // Rate limiting
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // Skip rate limiting for health checks
    if (req.url === "/health" || req.url === "/metrics") return;

    const clientIp = req.ip || "unknown";
    const result = rateLimiter.check(clientIp);

    reply.header("X-RateLimit-Limit", "100");
    reply.header("X-RateLimit-Remaining", String(result.remaining));
    reply.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      logger.warn({ ip: clientIp }, "Rate limit exceeded");
      reply.code(429).send({
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please try again later.",
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }
  });

  // Request ID tracking
  app.addHook("onRequest", async (req: FastifyRequest) => {
    const requestId = req.headers["x-request-id"] || crypto.randomUUID();
    (req as any).requestId = requestId;
  });

  logger.info("Security middleware registered");
}
