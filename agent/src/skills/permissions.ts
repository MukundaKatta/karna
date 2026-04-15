/**
 * Per-skill permission and rate-limit gate.
 *
 * Karna runs 97+ skills across 13 channels. This module is the single
 * choke point every skill invocation passes through: it checks the
 * caller's allowlist, per-skill daily quota, and confirms destructive
 * skills (delete, send-money, send-email-external) before they run.
 *
 * Designed to be trivially mockable in tests — no singletons, no
 * top-level state. Pass a `Clock` and a `Store` in.
 */

export type SkillRiskTier = "safe" | "external" | "destructive";

export type SkillManifestEntry = {
  id: string;
  risk: SkillRiskTier;
  /** Max invocations per user per rolling 24h. 0 = unlimited. */
  dailyLimit?: number;
  /** If true, caller must present a fresh confirmation token. */
  requiresConfirmation?: boolean;
};

export type InvocationContext = {
  userId: string;
  channel: string;
  skillId: string;
  confirmationToken?: string;
};

export type PermissionStore = {
  /** Is the user allowed to call this skill at all on this channel? */
  isAllowed(userId: string, skillId: string, channel: string): Promise<boolean>;
  /** Count invocations in the last 24h. */
  countRecent(userId: string, skillId: string, sinceMs: number): Promise<number>;
  /** Has the user accepted this confirmation token in the last 5 min? */
  consumeConfirmation(userId: string, token: string): Promise<boolean>;
};

export type Clock = { now(): number };

export type GateDecision =
  | { action: "allow" }
  | { action: "deny"; code: "not-allowed" | "rate-limited" | "needs-confirmation"; detail?: string };

export async function checkPermission(
  manifest: Record<string, SkillManifestEntry>,
  ctx: InvocationContext,
  store: PermissionStore,
  clock: Clock = { now: () => Date.now() },
): Promise<GateDecision> {
  const entry = manifest[ctx.skillId];
  if (!entry) return { action: "deny", code: "not-allowed", detail: "unknown skill" };

  if (!(await store.isAllowed(ctx.userId, ctx.skillId, ctx.channel))) {
    return { action: "deny", code: "not-allowed", detail: "user lacks skill grant" };
  }

  if (entry.dailyLimit && entry.dailyLimit > 0) {
    const since = clock.now() - 24 * 60 * 60 * 1000;
    const recent = await store.countRecent(ctx.userId, ctx.skillId, since);
    if (recent >= entry.dailyLimit) {
      return {
        action: "deny",
        code: "rate-limited",
        detail: `${recent}/${entry.dailyLimit} in the last 24h`,
      };
    }
  }

  if (entry.requiresConfirmation || entry.risk === "destructive") {
    if (!ctx.confirmationToken) {
      return { action: "deny", code: "needs-confirmation", detail: "destructive skill" };
    }
    const ok = await store.consumeConfirmation(ctx.userId, ctx.confirmationToken);
    if (!ok) {
      return { action: "deny", code: "needs-confirmation", detail: "token invalid or expired" };
    }
  }

  return { action: "allow" };
}

/**
 * Build a short, human-readable confirmation prompt for a destructive
 * skill. The channel layer surfaces this to the user before issuing a
 * token.
 */
export function confirmationPrompt(skillId: string, risk: SkillRiskTier, summary?: string): string {
  const verb = risk === "destructive" ? "This will permanently"
    : risk === "external" ? "This will contact an external service to"
    : "This will";
  const tail = summary ? ` ${verb} ${summary}.` : ` ${verb} run the \`${skillId}\` skill.`;
  return `Please confirm.${tail} Reply \`yes\` within 5 minutes to proceed.`;
}
