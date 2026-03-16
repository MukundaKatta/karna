// ─── Tool Registry ─────────────────────────────────────────────────────────

import type { ZodType } from "zod";
import pino from "pino";
import type { ToolRiskLevel } from "@karna/shared/types/tool.js";
import type { ChatTool } from "../models/provider.js";

const logger = pino({ name: "tool-registry" });

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Result from executing a tool.
 */
export interface ToolResult {
  output: unknown;
  isError: boolean;
  errorMessage?: string;
  durationMs: number;
}

/**
 * Execution context passed to tool handlers.
 */
export interface ToolExecutionContext {
  sessionId: string;
  agentId: string;
  userId?: string;
  workingDirectory?: string;
}

/**
 * A tool definition with its runtime execute function.
 */
export interface ToolDefinitionRuntime {
  /** Unique tool name (e.g. "shell_exec", "file_read"). */
  name: string;
  /** Human-readable description for the LLM. */
  description: string;
  /** JSON Schema for the tool parameters. */
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Zod schema for input validation (optional but recommended). */
  inputSchema?: ZodType;
  /** Risk level governs approval requirements. */
  riskLevel: ToolRiskLevel;
  /** Whether this tool requires human approval before execution. */
  requiresApproval: boolean;
  /** Execution timeout in milliseconds. */
  timeout: number;
  /** Tags for categorization and filtering. */
  tags?: string[];
  /** The tool handler. */
  execute: (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>;
}

/**
 * Agent-level tool policy controlling which tools are available.
 */
export interface ToolPolicy {
  /** If set, only these tools are available. */
  allowList?: string[];
  /** If set, these tools are excluded. */
  denyList?: string[];
  /** Override approval requirements per tool name. */
  approvalOverrides?: Record<string, boolean>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

/**
 * Central registry for all available tools.
 * Supports registration, filtering by agent policy, and lookup.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinitionRuntime>();

  /**
   * Register a tool. Throws if a tool with the same name is already registered.
   */
  register(tool: ToolDefinitionRuntime): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }

    logger.debug({ tool: tool.name, riskLevel: tool.riskLevel }, "Registered tool");
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool by name.
   */
  unregister(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) {
      logger.debug({ tool: name }, "Unregistered tool");
    }
    return removed;
  }

  /**
   * Get a single tool by name.
   */
  get(name: string): ToolDefinitionRuntime | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tools, optionally filtered by an agent policy.
   */
  getTools(policy?: ToolPolicy): ToolDefinitionRuntime[] {
    let tools = Array.from(this.tools.values());

    if (policy?.allowList && policy.allowList.length > 0) {
      const allowed = new Set(policy.allowList);
      tools = tools.filter((t) => allowed.has(t.name));
    }

    if (policy?.denyList && policy.denyList.length > 0) {
      const denied = new Set(policy.denyList);
      tools = tools.filter((t) => !denied.has(t.name));
    }

    // Apply approval overrides
    if (policy?.approvalOverrides) {
      tools = tools.map((t) => {
        const override = policy.approvalOverrides?.[t.name];
        if (override !== undefined) {
          return { ...t, requiresApproval: override };
        }
        return t;
      });
    }

    return tools;
  }

  /**
   * Convert tools into the LLM-compatible format for the chat API.
   */
  getChatTools(policy?: ToolPolicy): ChatTool[] {
    return this.getTools(policy).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  /**
   * Get the total count of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Clear all registered tools.
   */
  clear(): void {
    this.tools.clear();
  }
}
