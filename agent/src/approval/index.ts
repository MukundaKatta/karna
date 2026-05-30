// ─── Approval Subsystem (Issues #587, #588, #589, #590, #591) ─────────────────
//
// Additive, non-breaking approval features built alongside tools/approval.ts.
// Nothing here changes existing exported signatures; adapters opt in by importing
// from this barrel.

// #587 Configurable approval policies per risk level
export {
  RiskLevelPolicySchema,
  RiskLevelPolicyOverrideSchema,
  RiskLevelPolicyMapSchema,
  ScopedOverrideSchema,
  ApprovalPolicyConfigSchema,
  DEFAULT_BASE_POLICY,
  DEFAULT_APPROVAL_POLICY_CONFIG,
  resolveApprovalPolicy,
  parseApprovalPolicyConfig,
  type RiskLevelPolicy,
  type RiskLevelPolicyOverride,
  type RiskLevelPolicyMap,
  type ScopedOverride,
  type ApprovalPolicyConfig,
  type ApprovalPolicyContext,
} from "./policies.js";

// #589 Pause/resume long-running runs
export {
  RunStatusSchema,
  RunSnapshotSchema,
  RunController,
  InvalidRunTransitionError,
  isTerminal,
  isValidTransition,
  type RunStatus,
  type RunSnapshot,
  type PauseResumeOptions,
} from "./pause-resume.js";

// #590 Edit-and-continue tool arguments
export {
  editToolArgs,
  type EditResult,
  type EditRecord,
  type EditOptions,
} from "./edit-continue.js";

// #591 Approval audit trail
export {
  ApprovalDecisionKindSchema,
  AuditEntrySchema,
  ApprovalAuditTrail,
  type ApprovalDecisionKind,
  type AuditEntry,
  type AuditEntryInput,
  type AuditQuery,
  type AuditTrailOptions,
} from "./audit-trail.js";

// #588 Channel inline approve/deny correlation
export {
  InlineApprovalCorrelator,
  type InlineDecision,
  type PendingAction,
  type ResolveOutcome,
  type InlineApprovalOptions,
} from "./inline-approval.js";
