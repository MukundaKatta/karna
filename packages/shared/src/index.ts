// ─── Types ───────────────────────────────────────────────────────────────────

export * from "./types/protocol.js";
export * from "./types/session.js";
export * from "./types/tool.js";
export * from "./types/skill.js";
export * from "./types/memory.js";
export * from "./types/config.js";
export * from "./types/orchestration.js";
export * from "./types/access.js";

// ─── Utils ───────────────────────────────────────────────────────────────────

export {
  createLogger,
  createChildLogger,
  type Logger,
  type LoggerOptions,
  type LogLevel,
} from "./utils/logger.js";

export {
  generateToken,
  generateSessionId,
  generateMessageId,
  generateNumericCode,
  generateChallenge,
  hmacSign,
  hmacVerify,
  signPayload,
  verifyPayload,
} from "./utils/crypto.js";

export {
  PersistentSessionMap,
  getDefaultChannelSessionStorePath,
  type PersistentSessionMapOptions,
  type SessionMapLogger,
} from "./utils/persistent-session-map.js";

export {
  calculateCost,
  calculateTotalCost,
  getModelPricing,
  registerModelPricing,
  getRegisteredModels,
  formatCost,
  type ModelPricing,
  type TokenUsage,
  type CostBreakdown,
} from "./utils/cost.js";

// --- Additive exports: Issues #523, #562, #596, #579 ---
// Issue #523 — Control plane configuration layer
export {
  ApprovalActionSchema,
  ApprovalPolicySchema,
  ToolAccessConfigSchema,
  MemoryTierSettingsSchema,
  ModelRoutingPrefsSchema,
  BudgetConfigSchema,
  ControlPlaneConfigSchema,
  defaultControlPlaneConfig,
  mergeControlPlaneConfig,
} from "./types/control-plane.js";
export type {
  ApprovalAction,
  ApprovalPolicy,
  ToolAccessConfig,
  MemoryTierSettings,
  ModelRoutingPrefs,
  BudgetConfig,
  ControlPlaneConfig,
  DeepPartial,
} from "./types/control-plane.js";

// Issue #562 — Capability-based access tokens
export {
  CapabilityTokenSchema,
  issueCapability,
  isCapabilityExpired,
  capabilityAllowsTool,
  capabilityAllowsSkill,
  capabilityAllowsScope,
} from "./types/capability.js";
export type {
  CapabilityToken,
  IssueCapabilityOptions,
} from "./types/capability.js";

// Issue #596 — Streaming token budget
export { TokenBudget } from "./utils/budget.js";
export type {
  TokenBudgetLimits,
  TokenBudgetSnapshot,
  BudgetStopReason,
} from "./utils/budget.js";

// Issue #579 — Cost tracking per user/session/tool
export { CostAttributor, COST_UNATTRIBUTED } from "./utils/cost-attribution.js";
export type {
  CostEvent,
  RecordCostInput,
  CostDimension,
  CostAggregate,
} from "./utils/cost-attribution.js";

