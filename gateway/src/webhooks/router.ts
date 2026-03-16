// ─── Webhook Router ─────────────────────────────────────────────────────────
//
// Fastify route handler for incoming webhooks.
// Validates secrets, renders templates, and forwards to agent runtime.
//
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import pino from "pino";
import { WebhookStore, renderTemplate } from "./store.js";
import { parseGitHubWebhook, type GitHubEvent } from "./github.js";
import { parseStripeWebhook, type StripeEvent } from "./stripe.js";

const logger = pino({ name: "webhook-router" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WebhookRouterConfig {
  /** Prefix for webhook routes (default: "/webhooks"). */
  prefix?: string;
  /** Callback to forward the transformed message to the agent runtime. */
  onMessage: (agentId: string, message: string, metadata: WebhookMetadata) => Promise<void>;
}

export interface WebhookMetadata {
  webhookId: string;
  webhookName: string;
  urlPath: string;
  source: "generic" | "github" | "stripe";
  receivedAt: number;
}

// ─── Webhook Router ─────────────────────────────────────────────────────────

export class WebhookRouter {
  private readonly store: WebhookStore;
  private readonly config: WebhookRouterConfig;
  private readonly prefix: string;

  constructor(store: WebhookStore, config: WebhookRouterConfig) {
    this.store = store;
    this.config = config;
    this.prefix = config.prefix ?? "/webhooks";
  }

  /**
   * Register the webhook routes with a Fastify instance.
   */
  async register(fastify: FastifyInstance): Promise<void> {
    // Add raw body support for signature verification
    fastify.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (_req, body, done) => {
        try {
          const json = JSON.parse((body as Buffer).toString("utf-8")) as unknown;
          done(null, json);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );

    // Generic webhook endpoint
    fastify.post(
      `${this.prefix}/:path`,
      {
        config: {
          rawBody: true,
        },
      },
      async (request: FastifyRequest<{ Params: { path: string } }>, reply: FastifyReply) => {
        return this.handleWebhook(request, reply);
      },
    );

    // GitHub-specific endpoint
    fastify.post(
      `${this.prefix}/github/:path`,
      async (request: FastifyRequest<{ Params: { path: string } }>, reply: FastifyReply) => {
        return this.handleGitHubWebhook(request, reply);
      },
    );

    // Stripe-specific endpoint
    fastify.post(
      `${this.prefix}/stripe/:path`,
      async (request: FastifyRequest<{ Params: { path: string } }>, reply: FastifyReply) => {
        return this.handleStripeWebhook(request, reply);
      },
    );

    logger.info({ prefix: this.prefix }, "Webhook routes registered");
  }

  // ─── Generic Webhook ──────────────────────────────────────────────────

  private async handleWebhook(
    request: FastifyRequest<{ Params: { path: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { path } = request.params;
    const receivedAt = Date.now();

    const webhook = this.store.get(path);
    if (!webhook) {
      logger.warn({ path }, "Webhook not found");
      await reply.status(404).send({ error: "Webhook not found" });
      return;
    }

    if (!webhook.enabled) {
      logger.warn({ path }, "Webhook is disabled");
      await reply.status(403).send({ error: "Webhook is disabled" });
      return;
    }

    // Validate secret
    if (!this.validateSecret(request, webhook.secret)) {
      logger.warn({ path }, "Webhook secret validation failed");
      await reply.status(401).send({ error: "Unauthorized" });
      return;
    }

    const payload = request.body as Record<string, unknown>;

    // Render the template
    const message = renderTemplate(webhook.template, { payload });

    const metadata: WebhookMetadata = {
      webhookId: webhook.id,
      webhookName: webhook.name,
      urlPath: path,
      source: "generic",
      receivedAt,
    };

    try {
      await this.config.onMessage(webhook.agentId, message, metadata);
      await this.store.recordInvocation(path);

      logger.info(
        { path, agentId: webhook.agentId, messageLength: message.length },
        "Webhook processed successfully",
      );

      await reply.status(200).send({ ok: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ path, error: errorMessage }, "Webhook processing failed");
      await reply.status(500).send({ error: "Internal server error" });
    }
  }

  // ─── GitHub Webhook ───────────────────────────────────────────────────

  private async handleGitHubWebhook(
    request: FastifyRequest<{ Params: { path: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { path } = request.params;
    const receivedAt = Date.now();

    const webhook = this.store.get(path);
    if (!webhook || !webhook.enabled) {
      await reply.status(404).send({ error: "Webhook not found" });
      return;
    }

    const headers = request.headers as Record<string, string | undefined>;
    const body = request.body as Record<string, unknown>;
    const rawBody = request.rawBody ?? JSON.stringify(body);

    let event: GitHubEvent;
    try {
      event = parseGitHubWebhook(
        headers,
        body,
        webhook.secret,
        rawBody as string | Buffer,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ path, error: msg }, "GitHub webhook verification failed");
      await reply.status(401).send({ error: msg });
      return;
    }

    const metadata: WebhookMetadata = {
      webhookId: webhook.id,
      webhookName: webhook.name,
      urlPath: path,
      source: "github",
      receivedAt,
    };

    try {
      await this.config.onMessage(webhook.agentId, event.summary, metadata);
      await this.store.recordInvocation(path);

      logger.info(
        { path, eventType: event.type, action: event.action, repo: event.repository },
        "GitHub webhook processed",
      );

      await reply.status(200).send({ ok: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ path, error: errorMessage }, "GitHub webhook processing failed");
      await reply.status(500).send({ error: "Internal server error" });
    }
  }

  // ─── Stripe Webhook ───────────────────────────────────────────────────

  private async handleStripeWebhook(
    request: FastifyRequest<{ Params: { path: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { path } = request.params;
    const receivedAt = Date.now();

    const webhook = this.store.get(path);
    if (!webhook || !webhook.enabled) {
      await reply.status(404).send({ error: "Webhook not found" });
      return;
    }

    const headers = request.headers as Record<string, string | undefined>;
    const body = request.body as Record<string, unknown>;
    const rawBody = request.rawBody ?? JSON.stringify(body);

    let event: StripeEvent;
    try {
      event = parseStripeWebhook(
        headers,
        body,
        webhook.secret,
        rawBody as string | Buffer,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ path, error: msg }, "Stripe webhook verification failed");
      await reply.status(401).send({ error: msg });
      return;
    }

    const metadata: WebhookMetadata = {
      webhookId: webhook.id,
      webhookName: webhook.name,
      urlPath: path,
      source: "stripe",
      receivedAt,
    };

    try {
      await this.config.onMessage(webhook.agentId, event.summary, metadata);
      await this.store.recordInvocation(path);

      logger.info(
        { path, eventType: event.type, stripeEventId: event.id },
        "Stripe webhook processed",
      );

      await reply.status(200).send({ ok: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ path, error: errorMessage }, "Stripe webhook processing failed");
      await reply.status(500).send({ error: "Internal server error" });
    }
  }

  // ─── Secret Validation ────────────────────────────────────────────────

  /**
   * Validate webhook secret via X-Webhook-Secret header or HMAC signature.
   */
  private validateSecret(request: FastifyRequest, secret: string): boolean {
    const headers = request.headers;

    // Method 1: Direct secret comparison via header
    const headerSecret = headers["x-webhook-secret"] as string | undefined;
    if (headerSecret) {
      const a = Buffer.from(headerSecret);
      const b = Buffer.from(secret);
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    }

    // Method 2: HMAC signature verification
    const hmacSignature = headers["x-webhook-signature"] as string | undefined;
    if (hmacSignature) {
      const rawBody = typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body);
      const expected = createHmac("sha256", secret)
        .update(rawBody, "utf8")
        .digest("hex");

      const sigBuffer = Buffer.from(hmacSignature, "hex");
      const expectedBuffer = Buffer.from(expected, "hex");

      if (sigBuffer.length !== expectedBuffer.length) return false;
      return timingSafeEqual(sigBuffer, expectedBuffer);
    }

    // No authentication header provided
    logger.warn("No webhook authentication header found");
    return false;
  }
}

// Extend FastifyRequest to include rawBody (populated by the content type parser)
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string | Buffer;
  }
}
