// ─── Tool Input/Output Schema Validation (Issue #547) ────────────────────────
//
// Strict JSON-Schema-style validation of tool inputs (and optionally outputs)
// against the tool's Zod schema. Designed to be fed back to the model: the
// failure shape carries a human-readable, model-friendly error message.
//
// This module is OPT-IN: it only enforces validation when a Zod schema is
// present. The executor calls `validateToolInput` before execution; when no
// `inputSchema` is defined the call is a pass-through and behavior is unchanged.

import pino from "pino";
import type { ZodType } from "zod";
import type { ToolDefinitionRuntime } from "./registry.js";

const logger = pino({ name: "tool-validation" });

/**
 * Structured validation outcome. On success, `data` holds the parsed (and
 * possibly coerced/defaulted) value. On failure, `error` holds a message that
 * is safe to feed back to the model so it can correct the tool call.
 */
export type ValidationResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues: ValidationIssue[] };

/** A single field-level validation problem. */
export interface ValidationIssue {
  /** Dot-path to the offending field (empty string for the root). */
  path: string;
  /** Human-readable description of the problem. */
  message: string;
  /** Zod issue code, when available (e.g. "invalid_type"). */
  code?: string;
}

/**
 * Validate an arbitrary value against a Zod schema.
 *
 * Returns a structured result rather than throwing so the caller can decide
 * how to surface the error (typically: feed it back to the model).
 */
export function validateAgainstSchema<T = unknown>(
  schema: ZodType,
  value: unknown,
  label = "value"
): ValidationResult<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return { ok: true, data: parsed.data as T };
  }

  const issues: ValidationIssue[] = parsed.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
    code: i.code,
  }));

  const error = formatIssues(label, issues);
  return { ok: false, error, issues };
}

/**
 * Validate a tool call's input against the tool's `inputSchema`.
 *
 * If the tool has no `inputSchema`, validation is skipped and the original
 * input is returned unchanged (`ok: true`). This preserves existing behavior
 * for tools that have not opted in.
 */
export function validateToolInput(
  tool: ToolDefinitionRuntime,
  input: Record<string, unknown>
): ValidationResult<Record<string, unknown>> {
  if (!tool.inputSchema) {
    return { ok: true, data: input };
  }

  const result = validateAgainstSchema<Record<string, unknown>>(
    tool.inputSchema,
    input,
    `input for tool "${tool.name}"`
  );

  if (!result.ok) {
    logger.warn({ tool: tool.name, error: result.error }, "Tool input validation failed");
  }

  return result;
}

/**
 * Validate a tool's output against an optional `outputSchema`.
 *
 * Output validation is strictly opt-in: when `outputSchema` is absent the
 * output is returned unchanged. A validation failure does NOT throw; the caller
 * decides whether to treat it as an error.
 */
export function validateToolOutput(
  tool: ToolDefinitionRuntime,
  output: unknown
): ValidationResult<unknown> {
  if (!tool.outputSchema) {
    return { ok: true, data: output };
  }

  const result = validateAgainstSchema(
    tool.outputSchema,
    output,
    `output for tool "${tool.name}"`
  );

  if (!result.ok) {
    logger.warn({ tool: tool.name, error: result.error }, "Tool output validation failed");
  }

  return result;
}

/** Build a single combined, model-friendly message from a list of issues. */
function formatIssues(label: string, issues: ValidationIssue[]): string {
  const detail = issues
    .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
    .join("; ");
  return `Invalid ${label}: ${detail}`;
}
