// ─── Tool Plugin Interface ──────────────────────────────────────────────────
//
// Defines the contract for tool plugins. Tools are capabilities that
// the AI agent can invoke (e.g. web search, file operations, API calls).
//
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolRiskLevel } from "@karna/shared";
import type { z } from "zod";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * JSON Schema definition for tool parameters.
 */
export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface JsonSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

/**
 * Context provided to tool execution.
 */
export interface ToolContext {
  /** The current session ID. */
  sessionId: string;
  /** The agent ID executing this tool. */
  agentId: string;
  /** The user ID (if authenticated). */
  userId?: string;
  /** Working directory for file operations. */
  workingDirectory?: string;
  /** Abort signal for cancellation. */
  abortSignal?: AbortSignal;
}

/**
 * Result from tool execution.
 */
export interface ToolResult {
  /** The output data (serializable to JSON). */
  output: unknown;
  /** Whether the execution resulted in an error. */
  isError: boolean;
  /** Error message if isError is true. */
  errorMessage?: string;
  /** Execution duration in milliseconds. */
  durationMs?: number;
  /** Optional metadata about the execution. */
  metadata?: Record<string, unknown>;
}

// ─── Tool Plugin ────────────────────────────────────────────────────────────

/**
 * Interface for tool plugins.
 *
 * A tool plugin exposes a single capability that the AI agent can invoke.
 * Each tool has a name, description, parameter schema, risk level, and
 * an execute function.
 *
 * @example
 * ```ts
 * const weatherTool: ToolPlugin = {
 *   name: "get_weather",
 *   description: "Get current weather for a location",
 *   riskLevel: "low",
 *   parameters: {
 *     type: "object",
 *     properties: {
 *       location: { type: "string", description: "City name" },
 *     },
 *     required: ["location"],
 *   },
 *   async execute(input, context) {
 *     const weather = await fetchWeather(input.location as string);
 *     return { output: weather, isError: false };
 *   },
 * };
 * ```
 */
export interface ToolPlugin {
  /** Unique tool name (must match /^[a-zA-Z_][a-zA-Z0-9_.-]*$/). */
  name: string;

  /** Human-readable description for the LLM to understand when to use this tool. */
  description: string;

  /** Risk level governs whether user approval is required. */
  riskLevel: ToolRiskLevel;

  /** JSON Schema describing the tool's input parameters. */
  parameters: JsonSchema;

  /** Optional Zod schema for runtime input validation. */
  inputSchema?: z.ZodType;

  /** Whether this tool requires explicit user approval (overrides risk-based policy). */
  requiresApproval?: boolean;

  /** Execution timeout in milliseconds (default: 30000). */
  timeout?: number;

  /** Tags for categorization and filtering. */
  tags?: string[];

  /**
   * Execute the tool with validated input.
   *
   * @param input - Validated input matching the parameters schema
   * @param context - Execution context (session, agent, user info)
   * @returns Tool execution result
   */
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a ToolPlugin with type inference and defaults.
 */
export function defineTool(tool: ToolPlugin): ToolPlugin {
  return {
    requiresApproval: false,
    timeout: 30_000,
    tags: [],
    ...tool,
  };
}
