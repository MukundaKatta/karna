import { z } from "zod";

export const DmAccessModeSchema = z.enum(["pairing", "open", "closed"]);
export type DmAccessMode = z.infer<typeof DmAccessModeSchema>;

export const GroupActivationModeSchema = z.enum(["mention", "always", "allowlist", "off"]);
export type GroupActivationMode = z.infer<typeof GroupActivationModeSchema>;

export const PairingRequestSchema = z.object({
  code: z.string().min(1),
  userId: z.string().min(1),
  expiresAt: z.number().int(),
});
export type PairingRequest = z.infer<typeof PairingRequestSchema>;

export const PersistedAccessPolicySchema = z.object({
  dmMode: DmAccessModeSchema.default("pairing"),
  allowlist: z.array(z.string()).default([]),
  blocklist: z.array(z.string()).default([]),
  groupActivation: GroupActivationModeSchema.default("mention"),
  agentMentionNames: z.array(z.string()).default(["karna", "@karna"]),
  pendingPairings: z.array(PairingRequestSchema).default([]),
  pairedUsers: z.array(z.string()).default([]),
});
export type PersistedAccessPolicy = z.infer<typeof PersistedAccessPolicySchema>;

export const PersistedAccessPolicyFileSchema = z.record(PersistedAccessPolicySchema);
export type PersistedAccessPolicyFile = z.infer<typeof PersistedAccessPolicyFileSchema>;

export interface AccessPolicySnapshot extends PersistedAccessPolicy {
  channelId: string;
}

export function createDefaultPersistedAccessPolicy(
  overrides: Partial<PersistedAccessPolicy> = {},
): PersistedAccessPolicy {
  return normalizePersistedAccessPolicy(PersistedAccessPolicySchema.parse(overrides));
}

export function normalizePersistedAccessPolicy(
  policy: PersistedAccessPolicy,
  now = Date.now(),
): PersistedAccessPolicy {
  return {
    dmMode: policy.dmMode,
    allowlist: uniqueStrings(policy.allowlist),
    blocklist: uniqueStrings(policy.blocklist),
    groupActivation: policy.groupActivation,
    agentMentionNames: uniqueStrings(policy.agentMentionNames),
    pendingPairings: uniquePairings(policy.pendingPairings).filter((item) => item.expiresAt > now),
    pairedUsers: uniqueStrings(policy.pairedUsers),
  };
}

export function normalizePersistedAccessPolicyFile(
  policies: PersistedAccessPolicyFile,
  now = Date.now(),
): PersistedAccessPolicyFile {
  return Object.fromEntries(
    Object.entries(policies)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([channelId, policy]) => [channelId, normalizePersistedAccessPolicy(policy, now)]),
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function uniquePairings(values: readonly PairingRequest[]): PairingRequest[] {
  const deduped = new Map<string, PairingRequest>();

  for (const value of values) {
    deduped.set(value.code, value);
  }

  return Array.from(deduped.values()).sort((left, right) => left.expiresAt - right.expiresAt);
}
