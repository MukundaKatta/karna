import type { Command } from "commander";
import chalk from "chalk";
import { resolveGatewayHttpUrl } from "../lib/config.js";

type DmMode = "pairing" | "open" | "closed";
type GroupMode = "mention" | "always" | "allowlist" | "off";

interface PolicySnapshot {
  channelId: string;
  dmMode: DmMode;
  groupActivation: GroupMode;
  allowlist: string[];
  blocklist: string[];
  pairedUsers: string[];
  pendingPairings: Array<{ code: string; userId: string; expiresAt: number }>;
  agentMentionNames: string[];
}

export function registerAccessCommand(program: Command): void {
  const access = program
    .command("access")
    .description("Manage OpenClaw-style channel access controls for Karna")
    .option("-g, --gateway <url>", "Gateway URL");

  access
    .command("list")
    .description("List channel access policies")
    .action(async () => {
      const gatewayUrl = await resolveGatewayHttpUrl(access.opts().gateway as string | undefined);
      const result = await apiGet<{ policies: PolicySnapshot[] }>(`${gatewayUrl}/api/access/policies`);

      if (!result.policies.length) {
        console.log(chalk.yellow("No access policies found yet."));
        return;
      }

      for (const policy of result.policies) {
        printPolicy(policy);
        console.log();
      }
    });

  access
    .command("show <channel>")
    .description("Show a single channel access policy")
    .action(async (channel: string) => {
      const gatewayUrl = await resolveGatewayHttpUrl(access.opts().gateway as string | undefined);
      const result = await apiGet<{ policy: PolicySnapshot }>(`${gatewayUrl}/api/access/policies/${encodeURIComponent(channel)}`);
      printPolicy(result.policy);
    });

  access
    .command("dm-mode <channel> <mode>")
    .description("Set DM mode: pairing, open, or closed")
    .action(async (channel: string, mode: DmMode) => {
      const gatewayUrl = await resolveGatewayHttpUrl(access.opts().gateway as string | undefined);
      const result = await apiJson<{ policy: PolicySnapshot }>(`${gatewayUrl}/api/access/policies/${encodeURIComponent(channel)}`, "PATCH", { dmMode: mode });
      console.log(chalk.green(`Updated ${channel} DM mode to ${result.policy.dmMode}.`));
    });

  access
    .command("group-mode <channel> <mode>")
    .description("Set group activation mode: mention, always, allowlist, or off")
    .action(async (channel: string, mode: GroupMode) => {
      const gatewayUrl = await resolveGatewayHttpUrl(access.opts().gateway as string | undefined);
      const result = await apiJson<{ policy: PolicySnapshot }>(`${gatewayUrl}/api/access/policies/${encodeURIComponent(channel)}`, "PATCH", { groupActivation: mode });
      console.log(chalk.green(`Updated ${channel} group mode to ${result.policy.groupActivation}.`));
    });

  access
    .command("allow <channel> <userId>")
    .description("Allowlist a user for a channel")
    .action(async (channel: string, userId: string) => {
      const gatewayUrl = await resolveGatewayHttpUrl(access.opts().gateway as string | undefined);
      await apiJson(`${gatewayUrl}/api/access/policies/${encodeURIComponent(channel)}/allowlist`, "POST", { userId });
      console.log(chalk.green(`Allowlisted ${userId} on ${channel}.`));
    });

  access
    .command("unallow <channel> <userId>")
    .description("Remove a user from the allowlist")
    .action(async (channel: string, userId: string) => {
      const gatewayUrl = await resolveGatewayHttpUrl(access.opts().gateway as string | undefined);
      await apiDelete(`${gatewayUrl}/api/access/policies/${encodeURIComponent(channel)}/allowlist/${encodeURIComponent(userId)}`);
      console.log(chalk.green(`Removed ${userId} from the allowlist on ${channel}.`));
    });

  access
    .command("block <channel> <userId>")
    .description("Blocklist a user for a channel")
    .action(async (channel: string, userId: string) => {
      const gatewayUrl = await resolveGatewayHttpUrl(access.opts().gateway as string | undefined);
      await apiJson(`${gatewayUrl}/api/access/policies/${encodeURIComponent(channel)}/blocklist`, "POST", { userId });
      console.log(chalk.green(`Blocklisted ${userId} on ${channel}.`));
    });

  access
    .command("unblock <channel> <userId>")
    .description("Remove a user from the blocklist")
    .action(async (channel: string, userId: string) => {
      const gatewayUrl = await resolveGatewayHttpUrl(access.opts().gateway as string | undefined);
      await apiDelete(`${gatewayUrl}/api/access/policies/${encodeURIComponent(channel)}/blocklist/${encodeURIComponent(userId)}`);
      console.log(chalk.green(`Removed ${userId} from the blocklist on ${channel}.`));
    });

  access
    .command("approve <channel> <code>")
    .description("Approve a pending pairing code")
    .action(async (channel: string, code: string) => {
      const gatewayUrl = await resolveGatewayHttpUrl(access.opts().gateway as string | undefined);
      const result = await apiJson<{ success: boolean; userId: string }>(
        `${gatewayUrl}/api/access/policies/${encodeURIComponent(channel)}/pairings/approve`,
        "POST",
        { code },
      );
      console.log(chalk.green(`Approved pairing on ${channel} for ${result.userId}.`));
    });

  access
    .command("revoke <channel> <userId>")
    .description("Revoke a previously paired user")
    .action(async (channel: string, userId: string) => {
      const gatewayUrl = await resolveGatewayHttpUrl(access.opts().gateway as string | undefined);
      await apiDelete(`${gatewayUrl}/api/access/policies/${encodeURIComponent(channel)}/paired/${encodeURIComponent(userId)}`);
      console.log(chalk.green(`Revoked paired access for ${userId} on ${channel}.`));
    });
}

async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return handleResponse<T>(response);
}

async function apiJson<T>(url: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response);
}

async function apiDelete<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "DELETE" });
  return handleResponse<T>(response);
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${response.status}`);
  }
  return data;
}

function printPolicy(policy: PolicySnapshot): void {
  console.log(chalk.bold(policy.channelId));
  console.log(`  DM mode:       ${policy.dmMode}`);
  console.log(`  Group mode:    ${policy.groupActivation}`);
  console.log(`  Allowlist:     ${policy.allowlist.length ? policy.allowlist.join(", ") : "—"}`);
  console.log(`  Blocklist:     ${policy.blocklist.length ? policy.blocklist.join(", ") : "—"}`);
  console.log(`  Paired users:  ${policy.pairedUsers.length ? policy.pairedUsers.join(", ") : "—"}`);
  console.log(`  Mentions:      ${policy.agentMentionNames.length ? policy.agentMentionNames.join(", ") : "—"}`);

  if (policy.pendingPairings.length) {
    console.log("  Pending:");
    for (const pending of policy.pendingPairings) {
      console.log(
        `    - ${pending.code} -> ${pending.userId} (expires ${new Date(pending.expiresAt).toLocaleString()})`,
      );
    }
  } else {
    console.log("  Pending:       —");
  }
}
