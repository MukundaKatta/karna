// ─── Tool Security Barrel ─────────────────────────────────────────────────────
//
// Additive, opt-in security primitives for the tool layer. None of these change
// executor behavior by default; callers wire them in explicitly. See each
// module for details.

// #556 Pre-execution policy engine.
export {
  PolicyEngine,
  matchesCondition,
  type PolicyDecision,
  type PolicyInput,
  type PolicyCondition,
  type PolicyRule,
  type PolicyEvaluation,
  type PolicyEngineOptions,
} from "./policy-engine.js";

// #555 Open Agent Passport authorization.
export {
  checkPassport,
  assertPassport,
  PassportDeniedError,
  type AgentPassport,
  type PassportCheckRequest,
  type PassportError,
  type PassportDecision,
  type CheckPassportOptions,
} from "./passport.js";

// #557 Per-tool egress allowlists.
export {
  EgressPolicy,
  EgressDeniedError,
  assertEgressAllowed,
  type EgressRule,
  type EgressDecision,
} from "./egress.js";

// #558 Filesystem scoping.
export {
  resolveScoped,
  resolveScopedOrThrow,
  isPathInScope,
  PathScopeError,
  type ScopeResult,
  type ResolveScopedOptions,
} from "./fs-scope.js";

// #559 Secrets vault integration & redaction.
export {
  EnvSecretsProvider,
  InMemorySecretsProvider,
  injectSecrets,
  Redactor,
  redactSecrets,
  SECRET_PATTERNS,
  REDACTED,
  type SecretsProvider,
  type RedactorOptions,
} from "./secrets.js";

// #560 Prompt-injection detection.
export {
  detectInjection,
  detectInjectionSync,
  type InjectionResult,
  type InjectionSpan,
  type InjectionAction,
  type DetectInjectionOptions,
  type InjectionClassifier,
  type ClassifierResult,
} from "./injection.js";

// #565 Data exfiltration guardrails.
export {
  ExfilGuard,
  scanForExfil,
  PII_PATTERNS,
  type ExfilAction,
  type ExfilFinding,
  type ExfilScanResult,
  type ExfilGuardOptions,
} from "./exfil.js";
