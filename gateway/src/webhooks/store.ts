// ─── Webhook Store ──────────────────────────────────────────────────────────
//
// In-memory webhook storage with optional Supabase persistence.
// Supports template rendering with {{ payload.field }} syntax.
//
// ─────────────────────────────────────────────────────────────────────────────

import pino from "pino";

const logger = pino({ name: "webhook-store" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Webhook {
  /** Unique webhook ID. */
  id: string;
  /** The agent this webhook routes to. */
  agentId: string;
  /** Human-readable name. */
  name: string;
  /** URL path segment (e.g. "my-webhook" -> POST /webhooks/my-webhook). */
  urlPath: string;
  /** Shared secret for HMAC or header validation. */
  secret: string;
  /** Mustache-like template to transform the payload into a message. */
  template: string;
  /** Whether the webhook is active. */
  enabled: boolean;
  /** Creation timestamp. */
  createdAt: number;
  /** Last invocation timestamp. */
  lastInvokedAt?: number;
  /** Total invocation count. */
  invokeCount: number;
}

export interface CreateWebhookInput {
  agentId: string;
  name: string;
  urlPath: string;
  secret: string;
  template: string;
}

export interface SupabaseClient {
  from(table: string): {
    select(columns?: string): Promise<{ data: unknown[] | null; error: unknown }> & {
      eq(column: string, value: string): Promise<{ data: unknown[] | null; error: unknown }>;
    };
    insert(row: unknown): Promise<{ data: unknown; error: unknown }>;
    update(data: unknown): {
      eq(column: string, value: string): Promise<{ data: unknown; error: unknown }>;
    };
    delete(): {
      eq(column: string, value: string): Promise<{ data: unknown; error: unknown }>;
    };
  };
}

// ─── Template Rendering ─────────────────────────────────────────────────────

/**
 * Render a template string, replacing {{ path.to.value }} with the
 * corresponding value from the data object.
 */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = resolvePath(data, path);
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// ─── Webhook Store ──────────────────────────────────────────────────────────

export class WebhookStore {
  /** In-memory cache keyed by urlPath. */
  private readonly webhooks = new Map<string, Webhook>();
  private readonly supabase: SupabaseClient | null;
  private readonly tableName: string;

  constructor(options?: { supabase?: SupabaseClient; tableName?: string }) {
    this.supabase = options?.supabase ?? null;
    this.tableName = options?.tableName ?? "webhooks";
    logger.info(
      { persistent: !!this.supabase },
      "WebhookStore initialized",
    );
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────

  /**
   * Create a new webhook registration.
   */
  async create(input: CreateWebhookInput): Promise<Webhook> {
    if (this.webhooks.has(input.urlPath)) {
      throw new Error(`Webhook with path "${input.urlPath}" already exists`);
    }

    const now = Date.now();
    const webhook: Webhook = {
      id: `whk_${now}_${Math.random().toString(36).slice(2, 8)}`,
      agentId: input.agentId,
      name: input.name,
      urlPath: input.urlPath,
      secret: input.secret,
      template: input.template,
      enabled: true,
      createdAt: now,
      invokeCount: 0,
    };

    this.webhooks.set(webhook.urlPath, webhook);

    // Persist to Supabase if available
    if (this.supabase) {
      try {
        const { error } = await this.supabase.from(this.tableName).insert(webhook);
        if (error) {
          logger.error({ error, urlPath: webhook.urlPath }, "Failed to persist webhook to Supabase");
        }
      } catch (error) {
        logger.error({ error, urlPath: webhook.urlPath }, "Supabase insert error");
      }
    }

    logger.info(
      { id: webhook.id, urlPath: webhook.urlPath, agentId: webhook.agentId },
      "Webhook created",
    );

    return webhook;
  }

  /**
   * Get a webhook by its URL path.
   */
  get(urlPath: string): Webhook | null {
    return this.webhooks.get(urlPath) ?? null;
  }

  /**
   * List all webhooks for an agent.
   */
  list(agentId: string): Webhook[] {
    const results: Webhook[] = [];
    for (const webhook of this.webhooks.values()) {
      if (webhook.agentId === agentId) {
        results.push(webhook);
      }
    }
    return results;
  }

  /**
   * Delete a webhook by URL path.
   */
  async delete(urlPath: string): Promise<boolean> {
    const existed = this.webhooks.delete(urlPath);

    if (existed && this.supabase) {
      try {
        const { error } = await this.supabase.from(this.tableName).delete().eq("urlPath", urlPath);
        if (error) {
          logger.error({ error, urlPath }, "Failed to delete webhook from Supabase");
        }
      } catch (error) {
        logger.error({ error, urlPath }, "Supabase delete error");
      }
    }

    if (existed) {
      logger.info({ urlPath }, "Webhook deleted");
    }

    return existed;
  }

  /**
   * Record a webhook invocation (updates counter and timestamp).
   */
  async recordInvocation(urlPath: string): Promise<void> {
    const webhook = this.webhooks.get(urlPath);
    if (!webhook) return;

    webhook.lastInvokedAt = Date.now();
    webhook.invokeCount++;

    if (this.supabase) {
      try {
        const { error } = await this.supabase
          .from(this.tableName)
          .update({
            lastInvokedAt: webhook.lastInvokedAt,
            invokeCount: webhook.invokeCount,
          })
          .eq("urlPath", urlPath);
        if (error) {
          logger.error({ error, urlPath }, "Failed to update webhook invocation in Supabase");
        }
      } catch (error) {
        logger.error({ error, urlPath }, "Supabase update error");
      }
    }
  }

  /**
   * Load all webhooks from Supabase into the in-memory cache.
   */
  async loadFromSupabase(): Promise<void> {
    if (!this.supabase) return;

    try {
      const { data, error } = await this.supabase.from(this.tableName).select();
      if (error) {
        logger.error({ error }, "Failed to load webhooks from Supabase");
        return;
      }

      if (data && Array.isArray(data)) {
        for (const row of data) {
          const webhook = row as Webhook;
          this.webhooks.set(webhook.urlPath, webhook);
        }
        logger.info({ count: data.length }, "Loaded webhooks from Supabase");
      }
    } catch (error) {
      logger.error({ error }, "Supabase load error");
    }
  }

  /** Total number of registered webhooks. */
  get size(): number {
    return this.webhooks.size;
  }
}
