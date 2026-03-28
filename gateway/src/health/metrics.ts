import pino from "pino";

const logger = pino({ name: "metrics-collector" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestCount: number;
  costUsd: number;
}

export interface AggregatedMetrics {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalRequests: number;
  byModel: Record<string, ModelUsage>;
  startedAt: number;
  collectionDurationMs: number;
}

// ─── Default Model Pricing (per 1K tokens) ─────────────────────────────────

const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 0.003, output: 0.015 },
  "claude-opus-4-20250514": { input: 0.015, output: 0.075 },
  "claude-haiku-3-20250307": { input: 0.00025, output: 0.00125 },
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
};

// ─── Metrics Collector ──────────────────────────────────────────────────────

export class MetricsCollector {
  private readonly byModel = new Map<string, ModelUsage>();
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalRequests = 0;
  private totalCostUsd = 0;
  private readonly startedAt: number;
  private readonly customPricing: Record<string, { input: number; output: number }>;

  constructor(
    customPricing?: Record<string, { input: number; output: number }>,
  ) {
    this.startedAt = Date.now();
    this.customPricing = customPricing ?? {};
  }

  /**
   * Record a model usage event.
   *
   * @param model - The model identifier (e.g., "claude-sonnet-4-20250514")
   * @param inputTokens - Number of input tokens consumed
   * @param outputTokens - Number of output tokens generated
   */
  recordUsage(model: string, inputTokens: number, outputTokens: number): void {
    const cost = this.calculateCost(model, inputTokens, outputTokens);

    // Update global totals
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalRequests++;
    this.totalCostUsd += cost;

    // Update per-model totals
    let modelUsage = this.byModel.get(model);
    if (!modelUsage) {
      modelUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        costUsd: 0,
      };
      this.byModel.set(model, modelUsage);
    }

    modelUsage.inputTokens += inputTokens;
    modelUsage.outputTokens += outputTokens;
    modelUsage.totalTokens += inputTokens + outputTokens;
    modelUsage.requestCount++;
    modelUsage.costUsd += cost;

    logger.debug(
      { model, inputTokens, outputTokens, cost: cost.toFixed(6) },
      "Recorded usage",
    );
  }

  /**
   * Get the current aggregated metrics.
   */
  getMetrics(): AggregatedMetrics {
    const byModel: Record<string, ModelUsage> = {};

    for (const [model, usage] of this.byModel) {
      byModel[model] = { ...usage };
    }

    return {
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCostUsd: Math.round(this.totalCostUsd * 1_000_000) / 1_000_000,
      totalRequests: this.totalRequests,
      byModel,
      startedAt: this.startedAt,
      collectionDurationMs: Date.now() - this.startedAt,
    };
  }

  /**
   * Reset all metrics counters.
   */
  reset(): void {
    this.byModel.clear();
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalRequests = 0;
    this.totalCostUsd = 0;
    logger.info("Metrics reset");
  }

  /**
   * Render metrics in Prometheus text exposition format.
   */
  getPrometheusMetrics(connections = 0, sessions = 0): string {
    const lines: string[] = [];

    const ts = Date.now();

    // Counters
    lines.push("# HELP karna_requests_total Total number of LLM API requests");
    lines.push("# TYPE karna_requests_total counter");
    lines.push(`karna_requests_total ${this.totalRequests} ${ts}`);

    lines.push("# HELP karna_tokens_total Total tokens consumed");
    lines.push("# TYPE karna_tokens_total counter");
    lines.push(`karna_tokens_total{direction="input"} ${this.totalInputTokens} ${ts}`);
    lines.push(`karna_tokens_total{direction="output"} ${this.totalOutputTokens} ${ts}`);

    lines.push("# HELP karna_cost_usd_total Estimated cost in USD");
    lines.push("# TYPE karna_cost_usd_total counter");
    lines.push(`karna_cost_usd_total ${this.totalCostUsd.toFixed(6)} ${ts}`);

    // Gauges
    lines.push("# HELP karna_active_connections Current WebSocket connections");
    lines.push("# TYPE karna_active_connections gauge");
    lines.push(`karna_active_connections ${connections} ${ts}`);

    lines.push("# HELP karna_active_sessions Current active sessions");
    lines.push("# TYPE karna_active_sessions gauge");
    lines.push(`karna_active_sessions ${sessions} ${ts}`);

    // Per-model counters
    lines.push("# HELP karna_model_requests_total Requests per model");
    lines.push("# TYPE karna_model_requests_total counter");
    for (const [model, usage] of this.byModel) {
      lines.push(`karna_model_requests_total{model="${model}"} ${usage.requestCount} ${ts}`);
    }

    lines.push("# HELP karna_model_tokens_total Tokens per model");
    lines.push("# TYPE karna_model_tokens_total counter");
    for (const [model, usage] of this.byModel) {
      lines.push(`karna_model_tokens_total{model="${model}",direction="input"} ${usage.inputTokens} ${ts}`);
      lines.push(`karna_model_tokens_total{model="${model}",direction="output"} ${usage.outputTokens} ${ts}`);
    }

    return lines.join("\n") + "\n";
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const pricing =
      this.customPricing[model] ?? DEFAULT_PRICING[model];

    if (!pricing) {
      logger.debug({ model }, "No pricing data available for model");
      return 0;
    }

    const inputCost = (inputTokens / 1000) * pricing.input;
    const outputCost = (outputTokens / 1000) * pricing.output;

    return inputCost + outputCost;
  }
}
