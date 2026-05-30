// ─── SLO Module ───────────────────────────────────────────────────────────
//
// Issue #585 "SLOs and alerting".
//
// Public surface for the SLO subsystem plus a small catalogue of sensible
// default SLO definitions for the gateway. All re-exports are pure.
//
// ──────────────────────────────────────────────────────────────────────────

export type {
  SloKind,
  AlertSeverity,
  SloDefinition,
  SloSamples,
  SloEvaluation,
  SloAlert,
} from "./definitions.js";

export {
  DEFAULT_BURN_RATES,
  evaluateSlo,
  evaluateSlos,
  renderPrometheusAlertRules,
} from "./definitions.js";

import type { SloDefinition } from "./definitions.js";

/**
 * Default gateway SLOs: a 99.9% availability target, a p99 latency ceiling,
 * and an error-rate ceiling. Consumers may extend or override these.
 */
export const DEFAULT_GATEWAY_SLOS: SloDefinition[] = [
  {
    name: "gateway_availability",
    description: "Gateway request availability (successful responses / total).",
    kind: "availability",
    objective: 0.999,
    windowSeconds: 3600,
  },
  {
    name: "gateway_latency_p99",
    description: "Gateway request p99 latency.",
    kind: "latency_p99",
    objective: 1500,
    windowSeconds: 3600,
  },
  {
    name: "gateway_error_rate",
    description: "Gateway request error rate (errors / total).",
    kind: "error_rate",
    objective: 0.01,
    windowSeconds: 3600,
  },
];
