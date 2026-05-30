// ─── Tool Dry-Run / Preview (Issue #551) ─────────────────────────────────────
//
// Defines an optional `dryRun` capability convention for tools and a helper
// that produces a preview of what a tool call *would* do without executing it.
//
// The convention is non-breaking: tools may optionally expose a `dryRun`
// function (typed via `DryRunnableTool`). When absent, `previewToolCall`
// returns a generic, structured description of the intended call.

import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "./registry.js";
import { validateToolInput } from "./validation.js";

const logger = pino({ name: "tool-dry-run" });

/**
 * A structured preview of a tool call. `simulated` is true when the tool
 * provided its own `dryRun` implementation; false for the generic fallback.
 */
export interface ToolPreview {
  /** The tool that would be invoked. */
  toolName: string;
  /** A human-readable summary of the intended action. */
  summary: string;
  /** The (validated, when possible) input that would be passed. */
  input: Record<string, unknown>;
  /** The tool's risk level, surfaced for approval UX. */
  riskLevel: ToolDefinitionRuntime["riskLevel"];
  /** Whether executing this tool would require approval. */
  requiresApproval: boolean;
  /** True if produced by the tool's own dryRun; false if generic fallback. */
  simulated: boolean;
  /** Optional structured detail returned by a tool's own dryRun. */
  detail?: unknown;
  /** Validation problem, if the input failed schema validation. */
  validationError?: string;
}

/**
 * Optional signature a tool may implement to provide a rich, tool-specific
 * preview. Returns either a summary string or a partial preview-detail object.
 */
export type ToolDryRunFn = (
  input: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<DryRunOutcome> | DryRunOutcome;

/** What a tool's `dryRun` may return. */
export type DryRunOutcome =
  | string
  | {
      /** Override the generated summary. */
      summary?: string;
      /** Arbitrary structured detail (e.g. the command that would run). */
      detail?: unknown;
    };

/**
 * A tool that optionally implements the dry-run convention. Use this type to
 * read `tool.dryRun` without widening the core `ToolDefinitionRuntime`.
 */
export type DryRunnableTool = ToolDefinitionRuntime & { dryRun?: ToolDryRunFn };

/** Whether a tool exposes its own dry-run implementation. */
export function supportsDryRun(tool: ToolDefinitionRuntime): tool is DryRunnableTool {
  return typeof (tool as DryRunnableTool).dryRun === "function";
}

/**
 * Produce a preview of a tool call WITHOUT executing it.
 *
 * - If the tool implements `dryRun`, that is invoked to produce a rich preview.
 * - Otherwise a generic preview is synthesized from the tool's metadata.
 *
 * Input is validated against the tool's `inputSchema` when present; a
 * validation failure is reported in `validationError` rather than thrown, so
 * the preview is always available.
 */
export async function previewToolCall(
  tool: ToolDefinitionRuntime,
  input: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolPreview> {
  const validation = validateToolInput(tool, input);
  const validatedInput = validation.ok ? validation.data : input;
  const validationError = validation.ok ? undefined : validation.error;

  const base: ToolPreview = {
    toolName: tool.name,
    summary: genericSummary(tool, validatedInput),
    input: validatedInput,
    riskLevel: tool.riskLevel,
    requiresApproval: tool.requiresApproval,
    simulated: false,
    validationError,
  };

  if (supportsDryRun(tool)) {
    try {
      const outcome = await tool.dryRun!(validatedInput, context);
      if (typeof outcome === "string") {
        return { ...base, summary: outcome, simulated: true };
      }
      return {
        ...base,
        summary: outcome.summary ?? base.summary,
        detail: outcome.detail,
        simulated: true,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ tool: tool.name, error: message }, "dryRun threw; falling back to generic preview");
      return { ...base, detail: { dryRunError: message } };
    }
  }

  return base;
}

/** Build a generic, human-readable summary for a tool call. */
function genericSummary(tool: ToolDefinitionRuntime, input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  const argPart = keys.length > 0 ? ` with ${keys.length} argument${keys.length === 1 ? "" : "s"} (${keys.join(", ")})` : " with no arguments";
  return `Would call tool "${tool.name}" (risk: ${tool.riskLevel})${argPart}.`;
}
