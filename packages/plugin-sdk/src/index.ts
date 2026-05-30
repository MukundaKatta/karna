// ─── @karna/plugin-sdk ──────────────────────────────────────────────────────
//
// Public API for building Karna plugins.
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Channel ────────────────────────────────────────────────────────────────

export {
  type ChannelAdapter,
  type IncomingMessage,
  type MessageAttachment,
  type MessageHandler,
  type SendMessageOptions,
  BaseChannelAdapter,
} from "./channel.js";

// ─── Tool ───────────────────────────────────────────────────────────────────

export {
  type ToolPlugin,
  type ToolContext,
  type ToolResult,
  type JsonSchema,
  type JsonSchemaProperty,
  defineTool,
} from "./tool.js";

// ─── Skill ──────────────────────────────────────────────────────────────────

export {
  type SkillPlugin,
  type SkillContext,
  type SkillResult,
  type SkillTrigger,
  type SkillHandler,
  defineSkill,
} from "./skill.js";

// ─── Plugin ─────────────────────────────────────────────────────────────────

export {
  type KarnaPlugin,
  type PluginContext,
  definePlugin,
} from "./plugin.js";

// ─── Versioning & Deprecation (issue #549) ────────────────────────────────────

export {
  type DeprecationInfo,
  type VersionedMetadata,
  type VersionedLike,
  type DeprecationWarning,
  SemverSchema,
  DeprecationInfoSchema,
  VersionedMetadataSchema,
  isValidSemver,
  parseSemver,
  compareSemver,
  isSunset,
  withVersion,
  checkDeprecation,
  checkDeprecations,
} from "./versioning.js";

// ─── Dev Hot-Reload (issue #616) ──────────────────────────────────────────────

export {
  type ReloadReason,
  type ReloadEvent,
  type ReregisterCallback,
  type WatchFn,
  type HotReloadOptions,
  type Debouncer,
  createDebouncer,
  HotReloadWatcher,
  createHotReloadWatcher,
} from "./hot-reload.js";

// ─── Scaffold Eval Template (issue #617) ──────────────────────────────────────

export {
  type EvalScaffoldOptions,
  type ScaffoldedFile,
  generateEvalTasks,
  generateEvalScorer,
  generateEvalSpec,
  scaffoldEvalSuite,
} from "./scaffold-eval.js";

// ─── Signed Plugin Verification (issue #564) ──────────────────────────────────

export {
  type SignatureAlgorithm,
  type PluginSignature,
  type Manifest,
  type SignOptions,
  type VerifyOptions,
  type TrustPolicy,
  type TrustCheckResult,
  canonicalize,
  signManifest,
  attachSignature,
  verifyManifest,
  verifySignedManifest,
  checkTrust,
  verifyAndTrust,
} from "./signing.js";
