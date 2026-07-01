// ─── Model Pricing ───────────────────────────────────────────────────────────
// Prices are in USD per 1M tokens

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

/**
 * Pricing table for supported models.
 * Prices are in USD per 1 million tokens.
 * Updated as of 2025.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude models
  "claude-opus-4-20250514": {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  "claude-sonnet-4-20250514": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  "claude-haiku-4-20250514": {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1,
  },
  "claude-3-5-sonnet-20241022": {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  "claude-3-5-haiku-20241022": {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1,
  },

  // OpenAI models
  "gpt-4o": {
    inputPerMillion: 2.5,
    outputPerMillion: 10,
    cacheReadPerMillion: 1.25,
  },
  "gpt-4o-mini": {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cacheReadPerMillion: 0.075,
  },
  "gpt-4-turbo": {
    inputPerMillion: 10,
    outputPerMillion: 30,
  },
  "o1": {
    inputPerMillion: 15,
    outputPerMillion: 60,
    cacheReadPerMillion: 7.5,
  },
  "o1-mini": {
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cacheReadPerMillion: 0.55,
  },
  "o3-mini": {
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cacheReadPerMillion: 0.55,
  },
};

// ─── Token Usage ─────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
  model: string;
}

// ─── Cost Calculation ────────────────────────────────────────────────────────

/**
 * Calculate the cost of token usage for a given model.
 *
 * @param model - The model identifier (e.g., "claude-sonnet-4-20250514")
 * @param usage - Token counts for input, output, and optional cache usage
 * @returns A detailed cost breakdown in USD
 * @throws Error if the model is not found in the pricing table
 *
 * @example
 * ```ts
 * const cost = calculateCost("claude-sonnet-4-20250514", {
 *   inputTokens: 1000,
 *   outputTokens: 500,
 *   cacheReadTokens: 200,
 * });
 * console.log(`Total: $${cost.totalCost.toFixed(6)}`);
 * ```
 */
export function calculateCost(model: string, usage: TokenUsage): CostBreakdown {
  const pricing = getModelPricing(model);
  if (!pricing) {
    throw new Error(
      `Unknown model "${model}". Use registerModelPricing() to add custom models.`
    );
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheReadCost =
    usage.cacheReadTokens && pricing.cacheReadPerMillion
      ? (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion
      : 0;
  const cacheWriteCost =
    usage.cacheWriteTokens && pricing.cacheWritePerMillion
      ? (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion
      : 0;

  return {
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
    model,
  };
}

/**
 * Calculate cost and return only the total as a number.
 */
export function calculateTotalCost(model: string, usage: TokenUsage): number {
  return calculateCost(model, usage).totalCost;
}

// ─── Model Registry ──────────────────────────────────────────────────────────

/**
 * Get the pricing for a model.
 *
 * Resolution order:
 * 1. Exact match on the model id.
 * 2. Full-id match: a provider id with a date/version suffix resolves to its
 *    registered family base (e.g. "gpt-4o-mini-2024-07-18" -> "gpt-4o-mini",
 *    "claude-3-5-sonnet-latest" -> "claude-3-5-sonnet-20241022"). The longest
 *    (most specific) registered key that the model id starts with wins.
 * 3. Family-prefix match: a shorter family id resolves to its registered full
 *    id (e.g. "claude-sonnet-4" -> "claude-sonnet-4-20250514"). To avoid
 *    silently mispricing ambiguous prefixes, the prefix must be unambiguous —
 *    if it matches more than one registered model it is treated as unknown.
 *
 * An empty or whitespace-only model id always returns `undefined` rather than
 * matching an arbitrary entry.
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  const id = model.trim();
  if (!id) {
    return undefined;
  }

  // 1. Exact match first.
  if (MODEL_PRICING[id]) {
    return MODEL_PRICING[id];
  }

  const keys = Object.keys(MODEL_PRICING);

  // 2. Full-id match: the model id is more specific than (starts with) a
  // registered family base. Prefer the longest matching key.
  let baseMatch: string | undefined;
  for (const key of keys) {
    if (id.startsWith(key) && (!baseMatch || key.length > baseMatch.length)) {
      baseMatch = key;
    }
  }
  if (baseMatch) {
    return MODEL_PRICING[baseMatch];
  }

  // 3. Family-prefix match: a shorter family id is a prefix of registered
  // full ids. Only resolve when exactly one registered model matches so an
  // ambiguous prefix (e.g. "claude") does not silently pick the wrong price.
  const prefixMatches = keys.filter((key) => key.startsWith(id));
  if (prefixMatches.length === 1) {
    return MODEL_PRICING[prefixMatches[0]];
  }

  return undefined;
}

/**
 * Register custom model pricing at runtime.
 *
 * @param model - The model identifier
 * @param pricing - The pricing per million tokens
 */
export function registerModelPricing(model: string, pricing: ModelPricing): void {
  MODEL_PRICING[model] = pricing;
}

/**
 * Get all registered model names.
 */
export function getRegisteredModels(): string[] {
  return Object.keys(MODEL_PRICING);
}

/**
 * Format a cost value as a human-readable USD string.
 *
 * @param cost - Cost in USD
 * @param precision - Number of decimal places (default: 6)
 * @returns Formatted cost string (e.g., "$0.004500")
 */
export function formatCost(cost: number, precision = 6): string {
  return `$${cost.toFixed(precision)}`;
}
