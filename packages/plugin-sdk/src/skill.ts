// ─── Skill Plugin Interface ─────────────────────────────────────────────────
//
// Defines the contract for skill plugins. Skills are higher-level
// capabilities composed of tools and logic, triggered by patterns,
// commands, events, or schedules.
//
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolResult } from "./tool.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * How a skill can be triggered.
 */
export interface SkillTrigger {
  /** The trigger type. */
  type: "command" | "pattern" | "event" | "schedule";
  /**
   * The trigger value:
   * - command: the slash-command string (e.g. "/deploy")
   * - pattern: a regex pattern to match against messages
   * - event: the event name (e.g. "webhook.github.push")
   * - schedule: a cron expression
   */
  value: string;
  /** Human-readable description of when this trigger activates. */
  description?: string;
}

/**
 * Context provided to a skill handler.
 */
export interface SkillContext {
  /** The session ID where the skill was invoked. */
  sessionId: string;
  /** The agent ID running this skill. */
  agentId: string;
  /** The user ID (if authenticated). */
  userId?: string;
  /** The original trigger that activated the skill. */
  trigger: {
    type: SkillTrigger["type"];
    value: string;
  };
  /** The full message or event data that triggered the skill. */
  input: string;
  /** Parameters extracted from the trigger (e.g. command arguments, regex groups). */
  parameters: Record<string, unknown>;
  /** Execute a registered tool from within the skill. */
  executeTool: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<ToolResult>;
  /** Send a message back to the user. */
  reply: (content: string) => Promise<void>;
  /** Update the skill's status message. */
  setStatus: (message: string) => Promise<void>;
  /** Abort signal for cancellation. */
  abortSignal?: AbortSignal;
}

/**
 * Result from skill execution.
 */
export interface SkillResult {
  /** Whether the skill completed successfully. */
  success: boolean;
  /** The response message to send to the user. */
  response?: string;
  /** Structured output data. */
  data?: Record<string, unknown>;
  /** Error message if the skill failed. */
  error?: string;
}

/**
 * Skill handler function.
 */
export type SkillHandler = (context: SkillContext) => Promise<SkillResult>;

// ─── Skill Plugin ───────────────────────────────────────────────────────────

/**
 * Interface for skill plugins.
 *
 * A skill is a higher-level capability that can use multiple tools,
 * manage state across turns, and be triggered in various ways.
 *
 * @example
 * ```ts
 * const deploySkill: SkillPlugin = {
 *   name: "deploy",
 *   description: "Deploy to staging or production",
 *   triggers: [
 *     { type: "command", value: "/deploy", description: "Deploy command" },
 *     { type: "pattern", value: "deploy (.*) to (staging|production)" },
 *   ],
 *   async handler(context) {
 *     await context.setStatus("Starting deployment...");
 *     const result = await context.executeTool("shell_exec", {
 *       command: "deploy.sh",
 *     });
 *     return {
 *       success: !result.isError,
 *       response: result.isError
 *         ? `Deployment failed: ${result.errorMessage}`
 *         : "Deployment completed successfully!",
 *     };
 *   },
 * };
 * ```
 */
export interface SkillPlugin {
  /** Unique skill name. */
  name: string;

  /** Human-readable description. */
  description: string;

  /** Triggers that activate this skill. */
  triggers: SkillTrigger[];

  /** The skill handler function. */
  handler: SkillHandler;

  /** Optional setup called once when the skill is loaded. */
  setup?: () => Promise<void>;

  /** Optional teardown called when the skill is unloaded. */
  teardown?: () => Promise<void>;

  /** Tags for categorization. */
  tags?: string[];

  /** Version string (semver). */
  version?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a SkillPlugin with type inference and defaults.
 */
export function defineSkill(skill: SkillPlugin): SkillPlugin {
  return {
    tags: [],
    version: "0.1.0",
    ...skill,
  };
}
