// ─── Model Failover ─────────────────────────────────────────────────────────
// Automatic model failover with configurable fallback chains.
// If the primary model fails, tries the next model in the chain.

import pino from "pino";
import type { ModelProvider, ChatParams, StreamEvent } from "./provider.js";
import { AgentModelError } from "./anthropic.js";

const logger = pino({ name: "model-failover" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FailoverConfig {
  /** Primary model to use */
  primary: { provider: ModelProvider; model: string };
  /** Ordered fallback chain */
  fallbacks: Array<{ provider: ModelProvider; model: string }>;
  /** Max retries per model before moving to next */
  maxRetriesPerModel?: number;
  /** Whether to retry on rate limits before falling back */
  retryOnRateLimit?: boolean;
}

export interface FailoverResult {
  provider: ModelProvider;
  model: string;
  attemptedModels: string[];
  failoverUsed: boolean;
}

// ─── Failover Manager ──────────────────────────────────────────────────────

export class ModelFailover {
  private readonly config: FailoverConfig;
  private readonly maxRetries: number;

  constructor(config: FailoverConfig) {
    this.config = config;
    this.maxRetries = config.maxRetriesPerModel ?? 1;
  }

  /**
   * Execute a chat request with automatic failover.
   * Tries the primary model first, then falls back to alternatives.
   */
  async *chat(params: ChatParams): AsyncGenerator<StreamEvent> {
    const chain = [this.config.primary, ...this.config.fallbacks];
    const attemptedModels: string[] = [];

    for (let i = 0; i < chain.length; i++) {
      const { provider, model } = chain[i]!;
      attemptedModels.push(`${provider.name}/${model}`);

      for (let retry = 0; retry < this.maxRetries; retry++) {
        try {
          logger.debug(
            { provider: provider.name, model, attempt: retry + 1, chainIndex: i },
            "Attempting model",
          );

          const modifiedParams = { ...params, model };

          // Buffer events before yielding to prevent garbled output on failover.
          // If the stream fails mid-way, we discard the partial output and try
          // the next model cleanly instead of yielding partial + full response.
          const events: Array<unknown> = [];
          let streamCompleted = false;
          for await (const event of provider.chat(modifiedParams)) {
            events.push(event);
          }
          streamCompleted = true;

          // Stream completed successfully — yield all buffered events
          for (const event of events) {
            yield event as any;
          }

          // If we get here, the request succeeded
          if (i > 0) {
            logger.info(
              { provider: provider.name, model, failedModels: attemptedModels.slice(0, -1) },
              "Failover succeeded",
            );
          }
          return;
        } catch (error) {
          const isRateLimit = error instanceof AgentModelError && error.code === "RATE_LIMIT";
          const isAuthError = error instanceof AgentModelError && error.code === "AUTH_ERROR";
          const isUnavailable = error instanceof AgentModelError && error.code === "PROVIDER_UNAVAILABLE";

          // Auth errors and unavailable providers skip retries
          if (isAuthError || isUnavailable) {
            logger.warn(
              { provider: provider.name, model, code: (error as AgentModelError).code },
              "Provider unavailable, trying next",
            );
            break; // Skip to next provider
          }

          // Rate limits: retry if configured, otherwise fall back
          if (isRateLimit && this.config.retryOnRateLimit && retry < this.maxRetries - 1) {
            const delay = Math.min(1000 * Math.pow(2, retry), 30_000);
            logger.warn({ provider: provider.name, model, delay }, "Rate limited, retrying");
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          logger.warn(
            { provider: provider.name, model, error: String(error), attempt: retry + 1 },
            "Model attempt failed",
          );

          // If last retry for this model, break to try next model
          if (retry === this.maxRetries - 1) break;
        }
      }
    }

    // All models exhausted
    throw new AgentModelError(
      "PROVIDER_ERROR",
      `All models in failover chain exhausted. Attempted: ${attemptedModels.join(" → ")}`,
    );
  }

  /**
   * Get info about the current failover configuration.
   */
  getChainInfo(): { models: string[]; primaryModel: string } {
    const chain = [this.config.primary, ...this.config.fallbacks];
    return {
      models: chain.map((c) => `${c.provider.name}/${c.model}`),
      primaryModel: `${this.config.primary.provider.name}/${this.config.primary.model}`,
    };
  }
}
