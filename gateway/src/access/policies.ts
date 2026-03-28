// ─── DM Access Policies & Group Chat Routing ────────────────────────────────
// Controls who can message the agent and how group chats are handled.
// Inspired by OpenClaw's pairing mode and mention gating.

import pino from "pino";
import { randomInt } from "node:crypto";

const logger = pino({ name: "access-policies" });

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * DM access policy modes:
 * - "pairing": Requires approval code before accepting DMs (default, most secure)
 * - "open": Accepts all DMs (optionally filtered by allowlist)
 * - "closed": Rejects all DMs except from allowlisted users
 */
export type DmAccessMode = "pairing" | "open" | "closed";

/**
 * Group chat activation mode:
 * - "mention": Only respond when @mentioned or reply-tagged
 * - "always": Respond to every message in the group
 * - "off": Never respond in groups
 */
export type GroupActivationMode = "mention" | "always" | "off";

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

  constructor(options?: { pairingCodeLength?: number; pairingExpiryMs?: number }) {
    this.pairingCodeLength = options?.pairingCodeLength ?? 6;
    this.pairingExpiryMs = options?.pairingExpiryMs ?? 300_000; // 5 minutes
  }

  /**
   * Get or create the access policy for a channel.
   */
  getPolicy(channelId: string): AccessPolicy {
    let policy = this.policies.get(channelId);
    if (!policy) {
      policy = {
        dmMode: "pairing",
        allowlist: new Set(),
        blocklist: new Set(),
        groupActivation: "mention",
        agentMentionNames: ["karna", "@karna"],
        pendingPairings: new Map(),
        pairedUsers: new Set(),
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
    logger.info({ channelId, mode }, "DM access mode updated");
  }

  /**
   * Set group activation mode.
   */
  setGroupActivation(channelId: string, mode: GroupActivationMode): void {
    const policy = this.getPolicy(channelId);
    policy.groupActivation = mode;
    logger.info({ channelId, mode }, "Group activation mode updated");
  }

  /**
   * Add a user to the allowlist.
   */
  addToAllowlist(channelId: string, userId: string): void {
    this.getPolicy(channelId).allowlist.add(userId);
  }

  /**
   * Add a user to the blocklist.
   */
  addToBlocklist(channelId: string, userId: string): void {
    this.getPolicy(channelId).blocklist.add(userId);
  }

  /**
   * Check if a DM from a user should be processed.
   */
  checkDmAccess(channelId: string, userId: string): AccessDecision {
    const policy = this.getPolicy(channelId);

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
    const code = this.randomCode();

    policy.pendingPairings.set(code, {
      userId,
      expiresAt: Date.now() + this.pairingExpiryMs,
    });

    logger.info({ channelId, userId, code }, "Pairing code generated");
    return code;
  }

  /**
   * Verify a pairing code and pair the user.
   */
  verifyPairingCode(channelId: string, code: string): { success: boolean; userId?: string } {
    const policy = this.getPolicy(channelId);
    const pending = policy.pendingPairings.get(code);

    if (!pending) {
      return { success: false };
    }

    if (Date.now() > pending.expiresAt) {
      policy.pendingPairings.delete(code);
      return { success: false };
    }

    policy.pairedUsers.add(pending.userId);
    policy.pendingPairings.delete(code);

    logger.info({ channelId, userId: pending.userId }, "User paired successfully");
    return { success: true, userId: pending.userId };
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private randomCode(): string {
    const chars = "0123456789";
    let code = "";
    for (let i = 0; i < this.pairingCodeLength; i++) {
      code += chars[randomInt(chars.length)];
    }
    return code;
  }
}
