import { describe, expect, it } from "vitest";
import {
  auditAccessPolicies,
  buildMentionNames,
  getAccessManagedChannels,
} from "../../apps/cli/src/lib/access-policies.js";
import { createDefaultPersistedAccessPolicy } from "../../packages/shared/src/types/access.js";

describe("CLI access policy helpers", () => {
  it("builds deduped mention names and a compact handle", () => {
    expect(buildMentionNames("My Agent", ["@myagent", "MY AGENT"])).toEqual([
      "My Agent",
      "@myagent",
    ]);
  });

  it("treats pairing plus mention as a safe default", () => {
    const result = auditAccessPolicies(["telegram"], {
      telegram: createDefaultPersistedAccessPolicy(),
    });

    expect(result.status).toBe("pass");
    expect(result.message).toContain("reviewed");
    expect(result.detail).toContain("telegram: pairing/mention");
  });

  it("warns when channels are wide open", () => {
    const result = auditAccessPolicies(["telegram"], {
      telegram: createDefaultPersistedAccessPolicy({
        dmMode: "open",
        groupActivation: "always",
      }),
    });

    expect(result.status).toBe("warn");
    expect(result.detail).toContain("open DMs");
    expect(result.detail).toContain("always-on");
  });

  it("filters out local-only channels from access audits", () => {
    expect(getAccessManagedChannels(["telegram", "webchat", "cli", "discord"])).toEqual([
      "telegram",
      "discord",
    ]);
  });
});
