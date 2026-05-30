// ─── Extra Prometheus Metrics ─────────────────────────────────────────────
//
// Issue #580 "Expand Prometheus metrics".
//
// Additional counters / gauges / histograms that complement the core
// `MetricsCollector` in metrics.ts WITHOUT modifying it. The renderer here
// produces Prometheus text-exposition output for these extra series only; the
// gateway can concatenate it onto the existing `getPrometheusMetrics()` output.
//
// Metric families:
//   - tool latency (histogram, labelled by tool)
//   - model latency (histogram, labelled by model)
//   - model tokens (counter, labelled by model + direction)
//   - memory operations (counter, labelled by op + tier)
//   - queue depth (gauge, labelled by queue)
//   - active sub-agents (gauge)
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";

const logger = pino({ name: "extra-metrics" });

// ─── Label helpers ──────────────────────────────────────────────────────────

export type Labels = Record<string, string>;

/** Escape a Prometheus label value per the exposition format spec. */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

/** Render a `{k="v",...}` label block (empty string when no labels). */
function renderLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const parts = keys.map((k) => `${k}="${escapeLabelValue(labels[k]!)}"`);
  return `{${parts.join(",")}}`;
}

/** Stable key for a label set, used to bucket series. */
function labelKey(labels: Labels): string {
  return renderLabels(labels);
}

// ─── Histogram ───────────────────────────────────────────────────────────────

/** Default latency buckets in milliseconds. */
export const DEFAULT_LATENCY_BUCKETS_MS = [
  5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000,
];

interface HistogramSeries {
  labels: Labels;
  bucketCounts: number[]; // cumulative-able raw counts per bucket boundary
  sum: number;
  count: number;
}

/**
 * A label-aware Prometheus histogram with fixed bucket boundaries.
 * Buckets are upper bounds; an implicit `+Inf` bucket is always emitted.
 */
export class Histogram {
  readonly name: string;
  readonly help: string;
  private readonly buckets: number[];
  private readonly series = new Map<string, HistogramSeries>();

  constructor(name: string, help: string, buckets: number[] = DEFAULT_LATENCY_BUCKETS_MS) {
    this.name = name;
    this.help = help;
    // Ensure ascending, de-duplicated boundaries.
    this.buckets = [...new Set(buckets)].sort((a, b) => a - b);
  }

  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { labels, bucketCounts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    s.sum += value;
    s.count++;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]!) s.bucketCounts[i]!++;
    }
  }

  reset(): void {
    this.series.clear();
  }

  render(timestamp: number): string[] {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} histogram`);
    for (const s of this.series.values()) {
      // `bucketCounts[i]` already holds the cumulative count of observations
      // whose value is <= buckets[i] (see `observe`), so emit it directly.
      for (let i = 0; i < this.buckets.length; i++) {
        const le = String(this.buckets[i]);
        lines.push(
          `${this.name}_bucket${renderLabels({ ...s.labels, le })} ${s.bucketCounts[i]} ${timestamp}`,
        );
      }
      lines.push(
        `${this.name}_bucket${renderLabels({ ...s.labels, le: "+Inf" })} ${s.count} ${timestamp}`,
      );
      lines.push(`${this.name}_sum${renderLabels(s.labels)} ${s.sum} ${timestamp}`);
      lines.push(`${this.name}_count${renderLabels(s.labels)} ${s.count} ${timestamp}`);
    }
    return lines;
  }
}

// ─── Counter ─────────────────────────────────────────────────────────────────

export class Counter {
  readonly name: string;
  readonly help: string;
  private readonly series = new Map<string, { labels: Labels; value: number }>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: Labels = {}, amount = 1): void {
    const key = labelKey(labels);
    const s = this.series.get(key);
    if (s) {
      s.value += amount;
    } else {
      this.series.set(key, { labels, value: amount });
    }
  }

  reset(): void {
    this.series.clear();
  }

  render(timestamp: number): string[] {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} counter`);
    for (const s of this.series.values()) {
      lines.push(`${this.name}${renderLabels(s.labels)} ${s.value} ${timestamp}`);
    }
    return lines;
  }
}

// ─── Gauge ───────────────────────────────────────────────────────────────────

export class Gauge {
  readonly name: string;
  readonly help: string;
  private readonly series = new Map<string, { labels: Labels; value: number }>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  set(value: number, labels: Labels = {}): void {
    this.series.set(labelKey(labels), { labels, value });
  }

  inc(labels: Labels = {}, amount = 1): void {
    const key = labelKey(labels);
    const s = this.series.get(key);
    if (s) {
      s.value += amount;
    } else {
      this.series.set(key, { labels, value: amount });
    }
  }

  dec(labels: Labels = {}, amount = 1): void {
    this.inc(labels, -amount);
  }

  reset(): void {
    this.series.clear();
  }

  render(timestamp: number): string[] {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} gauge`);
    for (const s of this.series.values()) {
      lines.push(`${this.name}${renderLabels(s.labels)} ${s.value} ${timestamp}`);
    }
    return lines;
  }
}

// ─── Memory tier (mirrors agent memory tiers) ───────────────────────────────

export type MemoryTier = "working" | "short_term" | "long_term";
export type MemoryOp = "read" | "write" | "promote" | "evict";

// ─── Extra Metrics Registry ─────────────────────────────────────────────────

/**
 * Holds the expanded metric families and renders them as Prometheus text.
 * Designed to be appended to the existing exporter output; it never touches
 * the core `MetricsCollector` series, so existing metrics stay byte-identical.
 */
export class ExtraMetricsRegistry {
  readonly toolLatency: Histogram;
  readonly modelLatency: Histogram;
  readonly modelTokens: Counter;
  readonly memoryOps: Counter;
  readonly queueDepth: Gauge;
  readonly activeSubAgents: Gauge;

  constructor() {
    this.toolLatency = new Histogram(
      "karna_tool_latency_ms",
      "Tool execution latency in milliseconds",
    );
    this.modelLatency = new Histogram(
      "karna_model_latency_ms",
      "Model request latency in milliseconds",
    );
    this.modelTokens = new Counter(
      "karna_model_tokens_detailed_total",
      "Tokens per model and direction (expanded)",
    );
    this.memoryOps = new Counter(
      "karna_memory_operations_total",
      "Memory operations by type and tier",
    );
    this.queueDepth = new Gauge(
      "karna_queue_depth",
      "Current depth of internal work queues",
    );
    this.activeSubAgents = new Gauge(
      "karna_active_sub_agents",
      "Currently running sub-agents",
    );
  }

  // ─── Convenience recorders ────────────────────────────────────────────────

  recordToolLatency(toolName: string, durationMs: number, success = true): void {
    this.toolLatency.observe(durationMs, {
      tool: toolName,
      status: success ? "ok" : "error",
    });
  }

  recordModelLatency(model: string, durationMs: number): void {
    this.modelLatency.observe(durationMs, { model });
  }

  recordModelTokens(model: string, inputTokens: number, outputTokens: number): void {
    if (inputTokens) this.modelTokens.inc({ model, direction: "input" }, inputTokens);
    if (outputTokens) this.modelTokens.inc({ model, direction: "output" }, outputTokens);
  }

  recordMemoryOp(op: MemoryOp, tier: MemoryTier, count = 1): void {
    this.memoryOps.inc({ op, tier }, count);
  }

  setQueueDepth(queue: string, depth: number): void {
    this.queueDepth.set(depth, { queue });
  }

  setActiveSubAgents(count: number): void {
    this.activeSubAgents.set(count);
  }

  subAgentStarted(): void {
    this.activeSubAgents.inc();
  }

  subAgentStopped(): void {
    this.activeSubAgents.dec();
  }

  reset(): void {
    this.toolLatency.reset();
    this.modelLatency.reset();
    this.modelTokens.reset();
    this.memoryOps.reset();
    this.queueDepth.reset();
    this.activeSubAgents.reset();
  }

  /**
   * Render the extra metrics as a Prometheus text-exposition block ending in a
   * trailing newline (so it concatenates cleanly).
   */
  render(timestamp = Date.now()): string {
    const lines: string[] = [
      ...this.toolLatency.render(timestamp),
      ...this.modelLatency.render(timestamp),
      ...this.modelTokens.render(timestamp),
      ...this.memoryOps.render(timestamp),
      ...this.queueDepth.render(timestamp),
      ...this.activeSubAgents.render(timestamp),
    ];
    logger.debug({ lineCount: lines.length }, "Rendered extra metrics");
    return lines.length > 0 ? lines.join("\n") + "\n" : "";
  }

  /**
   * Append the extra metrics block to an existing Prometheus output string.
   * The existing content is preserved verbatim.
   */
  appendTo(existing: string, timestamp = Date.now()): string {
    const block = this.render(timestamp);
    if (!block) return existing;
    if (!existing) return block;
    const sep = existing.endsWith("\n") ? "" : "\n";
    return existing + sep + block;
  }
}
