// ─── DM Access Policies & Group Chat Routing ────────────────────────────────
// Controls who can message the agent and how group chats are handled.
// Inspired by OpenClaw's pairing mode and mention gating.

import pino from "pino";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  PersistedAccessPolicyFileSchema,
  createDefaultPersistedAccessPolicy,
  normalizePersistedAccessPolicyFile,
  type AccessPolicySnapshot,
  type DmAccessMode,
  type GroupActivationMode,
  type PairingRequest,
  type PersistedAccessPolicy,
} from "@karna/shared";

const logger = pino({ name: "access-policies" });

// ─── Types ──────────────────────────────────────────────────────────────────

export type { AccessPolicySnapshot, DmAccessMode, GroupActivationMode, PairingRequest };

export interface AccessPolicy {
  /** DM access mode */
  dmMode: DmAccessMode;
  /** Allowlisted user IDs (phone numbers, usernames, etc.) */
  allowlist: Set<string>;
  /** Blocklisted user IDs */
  blocklist: Set<string>;
  /** Group chat activation mode */
  groupActivation: GroupActivationMode;
  /** Agent name/handle for mention detection */
  agentMentionNames: string[];
  /** Pending pairing requests: code → userId */
  pendingPairings: Map<string, { userId: string; expiresAt: number }>;
  /** Approved paired users */
  pairedUsers: Set<string>;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
}

// ─── Access Policy Manager ─────────────────────────────────────────────────

export class AccessPolicyManager {
  private readonly policies = new Map<string, AccessPolicy>();
  private readonly pairingCodeLength: number;
  private readonly pairingExpiryMs: number;
  private readonly storagePath: string | null;

  constructor(options?: { pairingCodeLength?: number; pairingExpiryMs?: number; storagePath?: string | false }) {
    this.pairingCodeLength = options?.pairingCodeLength ?? 6;
    this.pairingExpiryMs = options?.pairingExpiryMs ?? 300_000; // 5 minutes
    this.storagePath = options?.storagePath === false ? null : (options?.storagePath ?? null);

    if (this.storagePath) {
      this.loadFromDisk();
    }
  }

  /**
   * Get or create the access policy for a channel.
   */
  getPolicy(channelId: string): AccessPolicy {
    let policy = this.policies.get(channelId);
    if (!policy) {
      const defaults = createDefaultPersistedAccessPolicy();
      policy = {
        dmMode: defaults.dmMode,
        allowlist: new Set(defaults.allowlist),
        blocklist: new Set(defaults.blocklist),
        groupActivation: defaults.groupActivation,
        agentMentionNames: [...defaults.agentMentionNames],
        pendingPairings: new Map(),
        pairedUsers: new Set(defaults.pairedUsers),
      };
      this.policies.set(channelId, policy);
    }
    return policy;
  }

  /**
   * Set the DM access mode for a channel.
   */
  setDmMode(channelId: string, mode: DmAccessMode): void {
    const policy = this.getPolicy(channelId);
    policy.dmMode = mode;
    this.persist();
    logger.info({ channelId, mode }, "DM access mode updated");
  }

  /**
   * Set group activation mode.
   */
  setGroupActivation(channelId: string, mode: GroupActivationMode): void {
    const policy = this.getPolicy(channelId);
    policy.groupActivation = mode;
    this.persist();
    logger.info({ channelId, mode }, "Group activation mode updated");
  }

  /**
   * Set the agent mention names used for group activation.
   */
  setAgentMentionNames(channelId: string, names: string[]): void {
    const policy = this.getPolicy(channelId);
    policy.agentMentionNames = names.filter(Boolean);
    this.persist();
    logger.info({ channelId, names: policy.agentMentionNames }, "Agent mention names updated");
  }

  /**
   * Add a user to the allowlist.
   */
  addToAllowlist(channelId: string, userId: string): void {
    this.getPolicy(channelId).allowlist.add(userId);
    this.persist();
  }

  /**
   * Remove a user from the allowlist.
   */
  removeFromAllowlist(channelId: string, userId: string): boolean {
    const removed = this.getPolicy(channelId).allowlist.delete(userId);
    if (removed) this.persist();
    return removed;
  }

  /**
   * Add a user to the blocklist.
   */
  addToBlocklist(channelId: string, userId: string): void {
    this.getPolicy(channelId).blocklist.add(userId);
    this.persist();
  }

  /**
   * Remove a user from the blocklist.
   */
  removeFromBlocklist(channelId: string, userId: string): boolean {
    const removed = this.getPolicy(channelId).blocklist.delete(userId);
    if (removed) this.persist();
    return removed;
  }

  /**
   * Check if a DM from a user should be processed.
   */
  checkDmAccess(channelId: string, userId: string): AccessDecision {
    const policy = this.getPolicy(channelId);
    this.cleanupExpiredPairings(policy);

    // Always block blocklisted users
    if (policy.blocklist.has(userId)) {
      return { allowed: false, reason: "User is blocklisted" };
    }

    // Always allow allowlisted users
    if (policy.allowlist.has(userId)) {
      return { allowed: true, reason: "User is allowlisted" };
    }

    switch (policy.dmMode) {
      case "open":
        return { allowed: true, reason: "DM mode is open" };

      case "closed":
        return { allowed: false, reason: "DM mode is closed — user not in allowlist" };

      case "pairing":
        if (policy.pairedUsers.has(userId)) {
          return { allowed: true, reason: "User is paired" };
        }
        return { allowed: false, reason: "Pairing required — send the pairing code to connect" };

      default:
        return { allowed: false, reason: "Unknown DM mode" };
    }
  }

  /**
   * Check if a group message should trigger a response.
   */
  checkGroupAccess(
    channelId: string,
    userId: string,
    messageContent: string,
    isReplyToAgent: boolean,
    agentMentioned = false,
  ): AccessDecision {
    const policy = this.getPolicy(channelId);

    if (policy.blocklist.has(userId)) {
      return { allowed: false, reason: "User is blocklisted" };
    }

    switch (policy.groupActivation) {
      case "always":
        return { allowed: true, reason: "Group mode is always-on" };

      case "off":
        return { allowed: false, reason: "Group mode is off" };

      case "mention": {
        // Check if the message mentions the agent
        if (isReplyToAgent) {
          return { allowed: true, reason: "Reply to agent" };
        }

        if (agentMentioned) {
          return { allowed: true, reason: "Agent mention flag supplied by channel" };
        }

        const lowerContent = messageContent.toLowerCase();
        const mentioned = policy.agentMentionNames.some((name) =>
          lowerContent.includes(name.toLowerCase()),
        );

        if (mentioned) {
          return { allowed: true, reason: "Agent mentioned in message" };
        }

        return { allowed: false, reason: "Agent not mentioned" };
      }

      default:
        return { allowed: false, reason: "Unknown group mode" };
    }
  }

  /**
   * Generate a pairing code for a user.
   */
  generatePairingCode(channelId: string, userId: string): string {
    const policy = this.getPolicy(channelId);
    this.cleanupExpiredPairings(policy);
    const code = this.randomCode();

    policy.pendingPairings.set(code, {
      userId,
      expiresAt: Date.now() + this.pairingExpiryMs,
    });

    this.persist();
    logger.info({ channelId, userId, code }, "Pairing code generated");
    return code;
  }

  /**
   * Get an existing unexpired pairing code for a user, or create a new one.
   */
  issuePairingCode(channelId: string, userId: string): PairingRequest {
    const policy = this.getPolicy(channelId);
    this.cleanupExpiredPairings(policy);

    for (const [code, pending] of policy.pendingPairings.entries()) {
      if (pending.userId === userId) {
        return { code, userId, expiresAt: pending.expiresAt };
      }
    }

    const code = this.generatePairingCode(channelId, userId);
    const pending = policy.pendingPairings.get(code);
    return {
      code,
      userId,
      expiresAt: pending?.expiresAt ?? Date.now() + this.pairingExpiryMs,
    };
  }

  /**
   * Verify a pairing code and pair the user.
   */
  verifyPairingCode(channelId: string, code: string): { success: boolean; userId?: string } {
    const policy = this.getPolicy(channelId);
    this.cleanupExpiredPairings(policy);
    const pending = policy.pendingPairings.get(code);

    if (!pending) {
      return { success: false };
    }

    if (Date.now() > pending.expiresAt) {
      policy.pendingPairings.delete(code);
      this.persist();
      return { success: false };
    }

    policy.pairedUsers.add(pending.userId);
    policy.pendingPairings.delete(code);

    this.persist();
    logger.info({ channelId, userId: pending.userId }, "User paired successfully");
    return { success: true, userId: pending.userId };
  }

  /**
   * Revoke a paired user.
   */
  revokePairedUser(channelId: string, userId: string): boolean {
    const policy = this.getPolicy(channelId);
    const removed = policy.pairedUsers.delete(userId);
    if (removed) this.persist();
    return removed;
  }

  /**
   * Return a serializable snapshot of a policy.
   */
  getPolicySnapshot(channelId: string): AccessPolicySnapshot {
    const policy = this.getPolicy(channelId);
    this.cleanupExpiredPairings(policy);

    return {
      channelId,
      dmMode: policy.dmMode,
      allowlist: Array.from(policy.allowlist).sort(),
      blocklist: Array.from(policy.blocklist).sort(),
      groupActivation: policy.groupActivation,
      agentMentionNames: [...policy.agentMentionNames],
      pendingPairings: Array.from(policy.pendingPairings.entries())
        .map(([code, pending]) => ({
          code,
          userId: pending.userId,
          expiresAt: pending.expiresAt,
        }))
        .sort((a, b) => a.expiresAt - b.expiresAt),
      pairedUsers: Array.from(policy.pairedUsers).sort(),
    };
  }

  /**
   * List all policies as serializable snapshots.
   */
  listPolicySnapshots(): AccessPolicySnapshot[] {
    return Array.from(this.policies.keys())
      .sort()
      .map((channelId) => this.getPolicySnapshot(channelId));
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private cleanupExpiredPairings(policy: AccessPolicy): void {
    const now = Date.now();
    let changed = false;
    for (const [code, pending] of policy.pendingPairings.entries()) {
      if (pending.expiresAt <= now) {
        policy.pendingPairings.delete(code);
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private randomCode(): string {
    const chars = "0123456789";
    let code = "";
    for (let i = 0; i < this.pairingCodeLength; i++) {
      code += chars[randomInt(chars.length)];
    }
    return code;
  }

  private persist(): void {
    if (!this.storagePath) return;

    try {
      mkdirSync(dirname(this.storagePath), { recursive: true });
      const serialized = normalizePersistedAccessPolicyFile(
        Object.fromEntries(
          Array.from(this.policies.entries()).map(([channelId, policy]) => [
            channelId,
            {
              dmMode: policy.dmMode,
              allowlist: Array.from(policy.allowlist),
              blocklist: Array.from(policy.blocklist),
              groupActivation: policy.groupActivation,
              agentMentionNames: [...policy.agentMentionNames],
              pendingPairings: Array.from(policy.pendingPairings.entries()).map(([code, pending]) => ({
                code,
                userId: pending.userId,
                expiresAt: pending.expiresAt,
              })),
              pairedUsers: Array.from(policy.pairedUsers),
            } satisfies PersistedAccessPolicy,
          ]),
        ),
      );

      writeFileSync(this.storagePath, JSON.stringify(serialized, null, 2), "utf-8");
    } catch (error) {
      logger.error({ error: String(error), storagePath: this.storagePath }, "Failed to persist access policies");
    }
  }

  private loadFromDisk(): void {
    if (!this.storagePath || !existsSync(this.storagePath)) return;

    try {
      const raw = readFileSync(this.storagePath, "utf-8");
      const parsedJson = JSON.parse(raw) as unknown;
      const parsed = PersistedAccessPolicyFileSchema.safeParse(parsedJson);

      if (!parsed.success) {
        logger.error(
          { storagePath: this.storagePath, issues: parsed.error.issues.slice(0, 5) },
          "Failed to validate access policies",
        );
        return;
      }

      for (const [channelId, snapshot] of Object.entries(normalizePersistedAccessPolicyFile(parsed.data))) {
        const policy: AccessPolicy = {
          dmMode: snapshot.dmMode,
          allowlist: new Set(snapshot.allowlist),
          blocklist: new Set(snapshot.blocklist),
          groupActivation: snapshot.groupActivation,
          agentMentionNames: snapshot.agentMentionNames,
          pendingPairings: new Map(
            snapshot.pendingPairings
              .filter((item) => item.expiresAt > Date.now())
              .map((item) => [item.code, { userId: item.userId, expiresAt: item.expiresAt }]),
          ),
          pairedUsers: new Set(snapshot.pairedUsers),
        };
        this.policies.set(channelId, policy);
      }

      logger.info({ policyCount: this.policies.size }, "Loaded persisted access policies");
    } catch (error) {
      logger.error({ error: String(error), storagePath: this.storagePath }, "Failed to load access policies");
    }
  }
}
