// ─── SLO Definitions & Evaluation ─────────────────────────────────────────
//
// Issue #585 "SLOs and alerting".
//
// Typed Service-Level-Objective definitions plus pure evaluation: given metric
// samples over a window, compute the achieved level, error-budget burn, and a
// breach/alert disposition. Also renders Prometheus alerting-rule YAML text so
// the same definitions can drive both in-process alerts and external alerting.
//
// Everything here is pure and dependency-free (no clock, no I/O).
//
// ──────────────────────────────────────────────────────────────────────────

// ─── SLO kinds ──────────────────────────────────────────────────────────────

/**
 * - `availability`  — fraction of good requests (objective is the floor).
 * - `error_rate`    — fraction of bad requests (objective is the ceiling).
 * - `latency_p99`   — p99 latency in ms (objective is the ceiling).
 */
export type SloKind = "availability" | "error_rate" | "latency_p99";

export type AlertSeverity = "none" | "warning" | "critical";

export interface SloDefinition {
  /** Stable machine name (used in metric/alert rule names). */
  name: string;
  /** Human-readable description. */
  description: string;
  kind: SloKind;
  /**
   * Target value. For `availability` this is the minimum acceptable ratio
   * (e.g. 0.999). For `error_rate` it is the maximum acceptable ratio. For
   * `latency_p99` it is the maximum acceptable p99 in milliseconds.
   */
  objective: number;
  /** Rolling evaluation window in seconds (informational + used in rules). */
  windowSeconds: number;
  /**
   * Burn-rate alert thresholds (multiples of the budget-consumption rate that
   * would exactly exhaust the budget over the window). Defaults applied by
   * `evaluateSlo` when omitted.
   */
  burnRates?: {
    warning: number;
    critical: number;
  };
}

export const DEFAULT_BURN_RATES = { warning: 2, critical: 10 } as const;

// ─── Samples & evaluation result ─────────────────────────────────────────────

/** Aggregated metric samples for one evaluation. */
export interface SloSamples {
  /** Total requests in the window (for availability / error_rate). */
  total?: number;
  /** Good requests in the window (availability). */
  good?: number;
  /** Bad requests in the window (error_rate / availability fallback). */
  bad?: number;
  /** Observed p99 latency in ms (latency_p99). */
  p99Ms?: number;
}

export interface SloEvaluation {
  name: string;
  kind: SloKind;
  objective: number;
  windowSeconds: number;
  /** Achieved value in the SLI's native units (ratio or ms). */
  achieved: number;
  /** True when the objective is currently satisfied. */
  withinObjective: boolean;
  /**
   * Fraction of the error budget consumed in this window, where 1.0 means the
   * budget for the window is fully spent. For latency this is a normalized
   * overage. `null` when not applicable (e.g. no traffic).
   */
  budgetConsumed: number | null;
  /** Burn rate = budgetConsumed normalized to "1.0 == exhaust over window". */
  burnRate: number | null;
  severity: AlertSeverity;
  /** Present when severity !== "none". */
  alert?: SloAlert;
}

export interface SloAlert {
  slo: string;
  kind: SloKind;
  severity: Exclude<AlertSeverity, "none">;
  message: string;
  objective: number;
  achieved: number;
  burnRate: number | null;
  windowSeconds: number;
  /** Caller may stamp a time; left unset by the pure evaluator. */
  timestamp?: number;
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

function ratioBad(samples: SloSamples): { total: number; bad: number } | null {
  const total = samples.total ?? (samples.good ?? 0) + (samples.bad ?? 0);
  if (total <= 0) return null;
  let bad: number;
  if (typeof samples.bad === "number") {
    bad = samples.bad;
  } else if (typeof samples.good === "number") {
    bad = total - samples.good;
  } else {
    return null;
  }
  return { total, bad: Math.max(0, bad) };
}

/**
 * Evaluate one SLO against samples. Pure: no clock, no I/O. Returns achieved
 * level, error-budget burn, and an alert disposition.
 */
export function evaluateSlo(slo: SloDefinition, samples: SloSamples): SloEvaluation {
  const burnRates = slo.burnRates ?? DEFAULT_BURN_RATES;
  const base = {
    name: slo.name,
    kind: slo.kind,
    objective: slo.objective,
    windowSeconds: slo.windowSeconds,
  };

  let achieved: number;
  let withinObjective: boolean;
  let budgetConsumed: number | null;
  let burnRate: number | null;

  if (slo.kind === "latency_p99") {
    achieved = samples.p99Ms ?? 0;
    withinObjective = achieved <= slo.objective;
    // Normalized overage relative to the objective; 0 when within budget.
    budgetConsumed = slo.objective > 0 ? Math.max(0, (achieved - slo.objective) / slo.objective) : null;
    burnRate = budgetConsumed;
  } else {
    const rb = ratioBad(samples);
    if (!rb) {
      // No traffic → nothing to assert.
      return { ...base, achieved: slo.kind === "availability" ? 1 : 0, withinObjective: true, budgetConsumed: null, burnRate: null, severity: "none" };
    }
    const errorRatio = rb.bad / rb.total;
    if (slo.kind === "availability") {
      achieved = 1 - errorRatio;
      withinObjective = achieved >= slo.objective;
      const budget = 1 - slo.objective; // allowed error fraction
      budgetConsumed = budget > 0 ? errorRatio / budget : errorRatio > 0 ? Infinity : 0;
    } else {
      // error_rate
      achieved = errorRatio;
      withinObjective = achieved <= slo.objective;
      const budget = slo.objective;
      budgetConsumed = budget > 0 ? errorRatio / budget : errorRatio > 0 ? Infinity : 0;
    }
    burnRate = budgetConsumed;
  }

  const severity = classifySeverity(burnRate, withinObjective, burnRates);
  const evaluation: SloEvaluation = {
    ...base,
    achieved,
    withinObjective,
    budgetConsumed,
    burnRate,
    severity,
  };
  if (severity !== "none") {
    evaluation.alert = {
      slo: slo.name,
      kind: slo.kind,
      severity,
      message: alertMessage(slo, achieved, burnRate, severity),
      objective: slo.objective,
      achieved,
      burnRate: Number.isFinite(burnRate ?? NaN) ? burnRate : null,
      windowSeconds: slo.windowSeconds,
    };
  }
  return evaluation;
}

function classifySeverity(
  burnRate: number | null,
  withinObjective: boolean,
  burnRates: { warning: number; critical: number },
): AlertSeverity {
  if (burnRate === null) return "none";
  if (burnRate >= burnRates.critical) return "critical";
  if (burnRate >= burnRates.warning) return "warning";
  // Objective breached but burn still low → warn so it's visible.
  if (!withinObjective && burnRate > 0) return "warning";
  return "none";
}

function fmt(kind: SloKind, value: number): string {
  if (kind === "latency_p99") return `${value.toFixed(1)}ms`;
  return `${(value * 100).toFixed(3)}%`;
}

function alertMessage(
  slo: SloDefinition,
  achieved: number,
  burnRate: number | null,
  severity: AlertSeverity,
): string {
  const objStr = fmt(slo.kind, slo.objective);
  const achStr = fmt(slo.kind, achieved);
  const burnStr = burnRate !== null && Number.isFinite(burnRate) ? ` (burn ${burnRate.toFixed(2)}x)` : "";
  const dir = slo.kind === "availability" ? "below" : "above";
  return `SLO ${slo.name} ${severity}: achieved ${achStr} is ${dir} objective ${objStr}${burnStr}`;
}

/** Evaluate many SLOs; returns only those producing an alert. */
export function evaluateSlos(
  slos: SloDefinition[],
  samplesByName: Record<string, SloSamples>,
): { evaluations: SloEvaluation[]; alerts: SloAlert[] } {
  const evaluations = slos.map((slo) => evaluateSlo(slo, samplesByName[slo.name] ?? {}));
  const alerts = evaluations
    .map((e) => e.alert)
    .filter((a): a is SloAlert => a !== undefined);
  return { evaluations, alerts };
}

// ─── Prometheus alert-rule rendering ─────────────────────────────────────────

function yamlString(value: string): string {
  // Double-quote and escape backslashes/quotes for safe YAML scalars.
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Build the PromQL `expr` for an SLO's burn-rate at a given multiplier. Uses
 * conventional recording-metric names derived from the SLO name; teams can
 * wire those recording rules separately. Pure string construction.
 */
function promExpr(slo: SloDefinition, multiplier: number, window: string): string {
  const metric = `slo:${slo.name}`;
  if (slo.kind === "latency_p99") {
    return `${metric}:p99_ms${window} > ${(slo.objective * multiplier).toString()}`;
  }
  if (slo.kind === "availability") {
    const budget = 1 - slo.objective;
    return `${metric}:error_ratio${window} > ${(budget * multiplier).toString()}`;
  }
  // error_rate
  return `${metric}:error_ratio${window} > ${(slo.objective * multiplier).toString()}`;
}

/**
 * Render Prometheus alerting rules (YAML text) for the given SLOs. One warning
 * and one critical rule per SLO, keyed off burn-rate thresholds. Pure.
 */
export function renderPrometheusAlertRules(slos: SloDefinition[], groupName = "karna_slo_alerts"): string {
  const lines: string[] = [];
  lines.push("groups:");
  lines.push(`  - name: ${groupName}`);
  lines.push("    rules:");

  for (const slo of slos) {
    const burnRates = slo.burnRates ?? DEFAULT_BURN_RATES;
    const window = `${slo.windowSeconds}s`;
    const levels: Array<{ sev: "warning" | "critical"; mult: number }> = [
      { sev: "warning", mult: burnRates.warning },
      { sev: "critical", mult: burnRates.critical },
    ];

    for (const { sev, mult } of levels) {
      const alertName = `${pascalish(slo.name)}${sev === "critical" ? "Critical" : "Warning"}`;
      lines.push(`      - alert: ${alertName}`);
      lines.push(`        expr: ${yamlString(promExpr(slo, mult, ""))}`);
      lines.push(`        for: ${window}`);
      lines.push("        labels:");
      lines.push(`          severity: ${sev}`);
      lines.push(`          slo: ${yamlString(slo.name)}`);
      lines.push(`          kind: ${yamlString(slo.kind)}`);
      lines.push("        annotations:");
      lines.push(`          summary: ${yamlString(`${slo.name} ${sev} SLO burn`)}`);
      lines.push(
        `          description: ${yamlString(`${slo.description} (objective ${slo.objective}, burn x${mult} over ${window})`)}`,
      );
    }
  }

  return lines.join("\n") + "\n";
}

function pascalish(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
