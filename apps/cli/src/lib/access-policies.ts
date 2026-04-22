import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  PersistedAccessPolicyFileSchema,
  createDefaultPersistedAccessPolicy,
  normalizePersistedAccessPolicy,
  normalizePersistedAccessPolicyFile,
  type DmAccessMode,
  type GroupActivationMode,
  type PersistedAccessPolicy,
  type PersistedAccessPolicyFile,
} from "@karna/shared";

export interface LoadedAccessPolicies {
  path: string;
  exists: boolean;
  policies: PersistedAccessPolicyFile;
  parseError?: string;
  validationErrors: string[];
}

export interface SeededChannelAccessPolicy {
  channelId: string;
  dmMode: DmAccessMode;
  groupActivation: GroupActivationMode;
  agentMentionNames: string[];
}

export interface AccessAuditResult {
  status: "pass" | "warn";
  message: string;
  detail?: string;
}

export function getAccessPolicyPath(): string {
  return join(homedir(), ".karna", "access", "policies.json");
}

export async function loadAccessPolicies(): Promise<LoadedAccessPolicies> {
  const policyPath = getAccessPolicyPath();

  try {
    const raw = await readFile(policyPath, "utf-8");
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      return {
        path: policyPath,
        exists: true,
        policies: {},
        parseError: error instanceof Error ? error.message : String(error),
        validationErrors: [],
      };
    }

    const parsed = PersistedAccessPolicyFileSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return {
        path: policyPath,
        exists: true,
        policies: {},
        validationErrors: parsed.error.issues.slice(0, 5).map((issue) =>
          `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        ),
      };
    }

    return {
      path: policyPath,
      exists: true,
      policies: normalizePersistedAccessPolicyFile(parsed.data),
      validationErrors: [],
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {
        path: policyPath,
        exists: false,
        policies: {},
        validationErrors: [],
      };
    }

    return {
      path: policyPath,
      exists: true,
      policies: {},
      parseError: err.message,
      validationErrors: [],
    };
  }
}

export async function seedAccessPolicies(
  seededPolicies: readonly SeededChannelAccessPolicy[],
): Promise<void> {
  if (!seededPolicies.length) {
    return;
  }

  const loaded = await loadAccessPolicies();
  const merged: PersistedAccessPolicyFile = { ...loaded.policies };

  for (const seeded of seededPolicies) {
    const existing = merged[seeded.channelId];
    merged[seeded.channelId] = normalizePersistedAccessPolicy(
      createDefaultPersistedAccessPolicy({
        ...existing,
        dmMode: seeded.dmMode,
        groupActivation: seeded.groupActivation,
        agentMentionNames: seeded.agentMentionNames,
      }),
    );
  }

  const policyPath = getAccessPolicyPath();
  await mkdir(dirname(policyPath), { recursive: true });
  await writeFile(
    policyPath,
    `${JSON.stringify(normalizePersistedAccessPolicyFile(merged), null, 2)}\n`,
    "utf-8",
  );
}

export function buildMentionNames(agentName: string, extraNames: readonly string[] = []): string[] {
  const trimmedName = agentName.trim();
  const compactHandle = trimmedName.replace(/[^A-Za-z0-9]+/g, "").toLowerCase();

  const values = [
    trimmedName,
    compactHandle ? `@${compactHandle}` : "",
    ...extraNames,
  ];

  const seen = new Set<string>();
  const names: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(trimmed);
  }

  return names;
}

export function auditAccessPolicies(
  enabledChannels: readonly string[],
  policies: PersistedAccessPolicyFile,
): AccessAuditResult {
  if (enabledChannels.length === 0) {
    return {
      status: "pass",
      message: "No external channels configured",
    };
  }

  const summaries = enabledChannels
    .map((channelId) => {
      const explicitPolicy = policies[channelId];
      const policy = normalizePersistedAccessPolicy(
        explicitPolicy ?? createDefaultPersistedAccessPolicy(),
      );
      return {
        channelId,
        explicit: explicitPolicy !== undefined,
        policy,
      };
    });

  const warnings = summaries.flatMap((summary) => describeAccessWarnings(summary.channelId, summary.policy));

  if (warnings.length > 0) {
    return {
      status: "warn",
      message: `${warnings.length} risky access setting${warnings.length === 1 ? "" : "s"} found`,
      detail: warnings.join("; "),
    };
  }

  return {
    status: "pass",
    message: `${summaries.length} channel access polic${summaries.length === 1 ? "y" : "ies"} reviewed`,
    detail: summaries
      .map(({ channelId, explicit, policy }) =>
        `${channelId}: ${policy.dmMode}/${policy.groupActivation}${explicit ? "" : " (runtime default)"}`,
      )
      .join("; "),
  };
}

export function getAccessManagedChannels(channelTypes: readonly string[]): string[] {
  return channelTypes.filter((channelType) => !LOCAL_ONLY_CHANNELS.has(channelType));
}

function describeAccessWarnings(
  channelId: string,
  policy: PersistedAccessPolicy,
): string[] {
  const warnings: string[] = [];

  if (policy.dmMode === "open") {
    warnings.push(`${channelId}: open DMs accept messages from any sender`);
  }

  if (policy.groupActivation === "always") {
    warnings.push(`${channelId}: group replies are always-on`);
  }

  if (policy.groupActivation === "allowlist" && policy.allowlist.length === 0) {
    warnings.push(`${channelId}: group allowlist mode is enabled but the allowlist is empty`);
  }

  return warnings;
}

const LOCAL_ONLY_CHANNELS = new Set([
  "web",
  "webchat",
  "cli",
  "mobile",
  "ios",
  "android",
]);
