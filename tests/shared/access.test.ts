import { describe, expect, it } from "vitest";
import {
  PersistedAccessPolicyFileSchema,
  createDefaultPersistedAccessPolicy,
  normalizePersistedAccessPolicyFile,
} from "../../packages/shared/src/types/access.js";

describe("Access Policy Types", () => {
  it("creates safe defaults", () => {
    const policy = createDefaultPersistedAccessPolicy();

    expect(policy.dmMode).toBe("pairing");
    expect(policy.groupActivation).toBe("mention");
    expect(policy.agentMentionNames).toEqual(["@karna", "karna"]);
  });

  it("normalizes persisted policy files by deduping and dropping expired pairings", () => {
    const now = Date.now();
    const parsed = PersistedAccessPolicyFileSchema.parse({
      telegram: {
        dmMode: "open",
        allowlist: ["alice", "alice", "bob"],
        blocklist: [" mallory ", "mallory"],
        groupActivation: "always",
        agentMentionNames: ["Karna", "@karna", "@karna"],
        pendingPairings: [
          { code: "111111", userId: "old-user", expiresAt: now - 1_000 },
          { code: "222222", userId: "new-user", expiresAt: now + 60_000 },
        ],
        pairedUsers: ["owner", "owner"],
      },
    });

    const normalized = normalizePersistedAccessPolicyFile(parsed, now);

    expect(normalized.telegram?.allowlist).toEqual(["alice", "bob"]);
    expect(normalized.telegram?.blocklist).toEqual(["mallory"]);
    expect(normalized.telegram?.pendingPairings).toEqual([
      { code: "222222", userId: "new-user", expiresAt: now + 60_000 },
    ]);
    expect(normalized.telegram?.pairedUsers).toEqual(["owner"]);
  });
});
