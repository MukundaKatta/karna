// ─── Open Agent Passport Authorization (Issue #555) ──────────────────────────
//
// An OAP-style "passport" carried by an agent, listing the audiences, tools,
// scopes and skills it is authorized to use. Before a tool executes, the
// passport is checked; a denial returns a structured error rather than throwing
// at the call site. Overhead is measured and returned for observability.
//
// Reuses the capability-token machinery from @karna/shared: a passport may
// embed one or more capability tokens, and the check honors their expiry and
// grants. The check is default-ALLOW when no passport is supplied, so wiring it
// in is non-breaking.

import { performance } from "node:perf_hooks";
import {
  type CapabilityToken,
  capabilityAllowsTool,
  capabilityAllowsScope,
  isCapabilityExpired,
} from "@karna/shared/types/capability.js";

/**
 * An agent passport. The `subject` identifies the bearer; `capabilities` are
 * the embedded capability tokens that actually grant access. `audience`
 * optionally restricts which resource servers / environments accept it.
 */
export interface AgentPassport {
  /** Passport identifier. */
  id: string;
  /** Bearer subject (agent id / user id). */
  subject: string;
  /** Embedded capability tokens (reused from @karna/shared). */
  capabilities: CapabilityToken[];
  /** Optional audiences this passport is valid for. */
  audience?: string[];
  /** Unix epoch ms after which the passport itself is invalid. */
  expiresAt?: number;
}

/** What is being authorized. */
export interface PassportCheckRequest {
  /** Tool the agent wishes to execute. */
  toolName: string;
  /** Data scopes the execution requires (e.g. ["files:write"]). */
  requiredScopes?: string[];
  /** Audience the request targets, matched against `passport.audience`. */
  audience?: string;
}

/** Structured authorization error returned on denial (not thrown). */
export interface PassportError {
  code:
    | "passport_expired"
    | "audience_mismatch"
    | "tool_not_granted"
    | "scope_not_granted"
    | "no_capabilities";
  message: string;
  /** The tool / scope that triggered the denial, when applicable. */
  detail?: string;
}

export interface PassportDecision {
  allowed: boolean;
  /** Present when `allowed` is false. */
  error?: PassportError;
  /** Wall-clock overhead of the check, in milliseconds. */
  overheadMs: number;
}

export interface CheckPassportOptions {
  /** Override the clock (ms) for deterministic tests. */
  now?: number;
}

/**
 * Authorize a tool execution against an agent passport.
 *
 * Default-allow: if `passport` is undefined, the request is permitted (overhead
 * still measured). Otherwise the passport must be unexpired, match the audience
 * (when both specify one), and contain a non-expired capability granting the
 * tool and every required scope.
 */
export function checkPassport(
  passport: AgentPassport | undefined,
  request: PassportCheckRequest,
  options: CheckPassportOptions = {},
): PassportDecision {
  const start = performance.now();
  const now = options.now ?? Date.now();

  const done = (allowed: boolean, error?: PassportError): PassportDecision => ({
    allowed,
    error,
    overheadMs: performance.now() - start,
  });

  if (!passport) {
    return done(true);
  }

  if (passport.expiresAt !== undefined && now >= passport.expiresAt) {
    return done(false, {
      code: "passport_expired",
      message: `Passport "${passport.id}" expired`,
    });
  }

  if (
    request.audience &&
    passport.audience &&
    passport.audience.length > 0 &&
    !passport.audience.includes(request.audience)
  ) {
    return done(false, {
      code: "audience_mismatch",
      message: `Passport not valid for audience "${request.audience}"`,
      detail: request.audience,
    });
  }

  // At least one non-expired capability must grant the tool.
  const liveCaps = passport.capabilities.filter((c) => !isCapabilityExpired(c, now));
  if (liveCaps.length === 0) {
    return done(false, {
      code: "no_capabilities",
      message: "Passport carries no live capabilities",
    });
  }

  const toolGranted = liveCaps.some((c) => capabilityAllowsTool(c, request.toolName, now));
  if (!toolGranted) {
    return done(false, {
      code: "tool_not_granted",
      message: `Tool "${request.toolName}" is not granted by any capability`,
      detail: request.toolName,
    });
  }

  // Every required scope must be granted by some live capability.
  for (const scope of request.requiredScopes ?? []) {
    const ok = liveCaps.some((c) => capabilityAllowsScope(c, scope, now));
    if (!ok) {
      return done(false, {
        code: "scope_not_granted",
        message: `Scope "${scope}" is not granted by any capability`,
        detail: scope,
      });
    }
  }

  return done(true);
}

/** Thrown by `assertPassport` for callers that prefer exceptions. */
export class PassportDeniedError extends Error {
  constructor(public readonly error: PassportError) {
    super(`Passport authorization denied [${error.code}]: ${error.message}`);
    this.name = "PassportDeniedError";
  }
}

/**
 * Throwing variant of {@link checkPassport}. Returns overhead on success or
 * throws {@link PassportDeniedError} with the structured error on denial.
 */
export function assertPassport(
  passport: AgentPassport | undefined,
  request: PassportCheckRequest,
  options: CheckPassportOptions = {},
): { overheadMs: number } {
  const decision = checkPassport(passport, request, options);
  if (!decision.allowed) {
    throw new PassportDeniedError(decision.error!);
  }
  return { overheadMs: decision.overheadMs };
}
