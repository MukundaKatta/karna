import { z } from "zod";
import { generateToken } from "../utils/crypto.js";

/**
 * Data scopes describe which categories of data a capability may touch.
 * Free-form strings (e.g. "memory:read", "files:write") to stay extensible.
 */
export const CapabilityTokenSchema = z.object({
  id: z.string().min(1),
  /** Subject the capability was issued to (user id, agent id, etc). */
  subject: z.string().min(1),
  /** Allowed tool names. Empty array means "no tools". */
  tools: z.array(z.string()).default([]),
  /** Allowed skill names. Empty array means "no skills". */
  skills: z.array(z.string()).default([]),
  /** Allowed data scopes. Empty array means "no scopes". */
  scopes: z.array(z.string()).default([]),
  /** Unix epoch milliseconds at which the capability was issued. */
  issuedAt: z.number().int().nonnegative(),
  /** Unix epoch milliseconds after which the capability is invalid. */
  expiresAt: z.number().int().nonnegative(),
});
export type CapabilityToken = z.infer<typeof CapabilityTokenSchema>;

export interface IssueCapabilityOptions {
  subject: string;
  tools?: string[];
  skills?: string[];
  scopes?: string[];
  /** Time-to-live in milliseconds. Defaults to one hour. */
  ttlMs?: number;
  /** Override the issue time (defaults to Date.now()). Useful for tests. */
  now?: number;
  /** Override the generated id (defaults to a random token). */
  id?: string;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Issue a new capability token. Pure aside from id/time generation, which can
 * be overridden for deterministic use.
 */
export function issueCapability(options: IssueCapabilityOptions): CapabilityToken {
  const now = options.now ?? Date.now();
  const ttl = options.ttlMs ?? ONE_HOUR_MS;
  return CapabilityTokenSchema.parse({
    id: options.id ?? generateToken(16),
    subject: options.subject,
    tools: options.tools ?? [],
    skills: options.skills ?? [],
    scopes: options.scopes ?? [],
    issuedAt: now,
    expiresAt: now + ttl,
  });
}

/**
 * Whether the capability grants access to a given tool name. Expired tokens
 * grant nothing.
 */
export function capabilityAllowsTool(
  cap: CapabilityToken,
  toolName: string,
  now?: number,
): boolean {
  if (isCapabilityExpired(cap, now)) return false;
  return cap.tools.includes(toolName);
}

/**
 * Whether the capability grants access to a given skill name. Expired tokens
 * grant nothing.
 */
export function capabilityAllowsSkill(
  cap: CapabilityToken,
  skillName: string,
  now?: number,
): boolean {
  if (isCapabilityExpired(cap, now)) return false;
  return cap.skills.includes(skillName);
}

/**
 * Whether the capability grants a given data scope. Expired tokens grant
 * nothing.
 */
export function capabilityAllowsScope(
  cap: CapabilityToken,
  scope: string,
  now?: number,
): boolean {
  if (isCapabilityExpired(cap, now)) return false;
  return cap.scopes.includes(scope);
}

/**
 * Whether the capability is expired relative to `now` (defaults to Date.now()).
 */
export function isCapabilityExpired(cap: CapabilityToken, now?: number): boolean {
  return (now ?? Date.now()) >= cap.expiresAt;
}
