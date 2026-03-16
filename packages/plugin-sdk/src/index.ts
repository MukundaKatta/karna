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
