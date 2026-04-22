import type { Command } from "commander";
import chalk from "chalk";
import type { SessionStatus } from "@karna/shared/types/session.js";
import { resolveGatewayHttpUrl } from "../lib/config.js";
import {
  fetchSession,
  fetchSessions,
  fetchSessionSummary,
  terminateSession,
  terminateSessions,
  updateSessionStatus,
} from "../lib/sessions.js";

interface SessionFilterFlags {
  channel?: string;
  agent?: string;
  user?: string;
  status?: SessionStatus;
  limit?: string;
  staleAfterMs?: string;
  all?: boolean;
  json?: boolean;
}

type MutableSessionStatus = Exclude<SessionStatus, "terminated">;

export function registerSessionsCommand(program: Command): void {
  const sessions = program
    .command("sessions")
    .description("Inspect and repair live Karna sessions")
    .option("-g, --gateway <url>", "Gateway URL");

  sessions
    .command("list")
    .description("List live sessions")
    .option("-c, --channel <type>", "Filter by channel type")
    .option("-a, --agent <id>", "Filter by agent/channel id")
    .option("-u, --user <id>", "Filter by user id")
    .option("-s, --status <status>", "Filter by status")
    .option("-l, --limit <count>", "Limit results", "25")
    .option("--json", "Print raw JSON", false)
    .action(async (options: SessionFilterFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(sessions.opts().gateway as string | undefined);
      const result = await fetchSessions(gatewayUrl, buildFilter(options));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.sessions.length) {
        console.log(chalk.yellow("No live sessions matched the filters."));
        return;
      }

      console.log(chalk.bold(`\nLive sessions (${result.total})\n`));
      for (const session of result.sessions) {
        printSessionLine(session);
      }
      console.log();
    });

  sessions
    .command("summary")
    .description("Show a compact session summary")
    .option("-c, --channel <type>", "Filter by channel type")
    .option("-a, --agent <id>", "Filter by agent/channel id")
    .option("-u, --user <id>", "Filter by user id")
    .option("-s, --status <status>", "Filter by status")
    .option("--stale-after-ms <ms>", "Mark sessions stale after this many milliseconds")
    .action(async (options: SessionFilterFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(sessions.opts().gateway as string | undefined);
      const summary = await fetchSessionSummary(gatewayUrl, buildFilter(options));
      printSummary(summary);
    });

  sessions
    .command("show <sessionId>")
    .description("Show full details for a session")
    .option("--json", "Print raw JSON", false)
    .action(async (sessionId: string, options: SessionFilterFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(sessions.opts().gateway as string | undefined);
      const session = await fetchSession(gatewayUrl, sessionId);

      if (options.json) {
        console.log(JSON.stringify(session, null, 2));
        return;
      }

      printSession(session);
    });

  sessions
    .command("status <sessionId> <status>")
    .description("Update a session status to active, idle, or suspended")
    .action(async (sessionId: string, status: MutableSessionStatus) => {
      const gatewayUrl = await resolveGatewayHttpUrl(sessions.opts().gateway as string | undefined);
      const session = await updateSessionStatus(gatewayUrl, sessionId, status);
      console.log(chalk.green(`Updated ${session.id} to ${session.status}.`));
    });

  sessions
    .command("terminate <sessionId>")
    .description("Terminate a single live session")
    .action(async (sessionId: string) => {
      const gatewayUrl = await resolveGatewayHttpUrl(sessions.opts().gateway as string | undefined);
      await terminateSession(gatewayUrl, sessionId);
      console.log(chalk.green(`Terminated ${sessionId}.`));
    });

  sessions
    .command("reset")
    .description("Terminate a filtered set of live sessions")
    .option("-c, --channel <type>", "Filter by channel type")
    .option("-a, --agent <id>", "Filter by agent/channel id")
    .option("-u, --user <id>", "Filter by user id")
    .option("-s, --status <status>", "Filter by status")
    .option("--all", "Terminate every live session", false)
    .action(async (options: SessionFilterFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(sessions.opts().gateway as string | undefined);
      const removed = await terminateSessions(gatewayUrl, {
        ...buildFilter(options),
        all: options.all,
      });
      console.log(chalk.green(`Terminated ${removed} session${removed === 1 ? "" : "s"}.`));
    });
}

function buildFilter(options: SessionFilterFlags) {
  return {
    channelType: options.channel,
    channelId: options.agent,
    userId: options.user,
    status: options.status,
    limit: options.limit ? Number(options.limit) : undefined,
    staleAfterMs: options.staleAfterMs ? Number(options.staleAfterMs) : undefined,
  };
}

function printSessionLine(session: Awaited<ReturnType<typeof fetchSession>>): void {
  const age = formatRelativeTime(session.updatedAt);
  const user = session.userId ? ` user=${session.userId}` : "";
  console.log(
    `${chalk.bold(session.id)}  ${session.channelType}/${session.channelId}  ${session.status}  ${age}${user}`,
  );
}

function printSession(session: Awaited<ReturnType<typeof fetchSession>>): void {
  console.log(chalk.bold(`\nSession ${session.id}\n`));
  console.log(`  Channel:      ${session.channelType}`);
  console.log(`  Agent:        ${session.channelId}`);
  console.log(`  User:         ${session.userId ?? "—"}`);
  console.log(`  Status:       ${session.status}`);
  console.log(`  Created:      ${new Date(session.createdAt).toLocaleString()}`);
  console.log(`  Updated:      ${new Date(session.updatedAt).toLocaleString()}`);
  console.log(`  Expires:      ${session.expiresAt ? new Date(session.expiresAt).toLocaleString() : "—"}`);
  console.log(`  Messages:     ${session.stats?.messageCount ?? 0}`);
  console.log(`  Input tokens: ${session.stats?.totalInputTokens ?? 0}`);
  console.log(`  Output tokens:${session.stats?.totalOutputTokens ?? 0}`);
  console.log(`  Cost USD:     ${(session.stats?.totalCostUsd ?? 0).toFixed(4)}`);
  console.log(`  Metadata:     ${session.metadata ? JSON.stringify(session.metadata) : "—"}`);
  console.log();
}

function printSummary(summary: Awaited<ReturnType<typeof fetchSessionSummary>>): void {
  console.log(chalk.bold("\nSession Summary\n"));
  console.log(`  Total live:   ${summary.total}`);
  console.log(`  Stale:        ${summary.staleSessions}`);
  console.log(`  Threshold:    ${Math.round(summary.staleAfterMs / 60_000)}m`);
  console.log(`  Oldest touch: ${summary.oldestUpdatedAt ? new Date(summary.oldestUpdatedAt).toLocaleString() : "—"}`);
  console.log(`  Newest touch: ${summary.newestUpdatedAt ? new Date(summary.newestUpdatedAt).toLocaleString() : "—"}`);
  console.log(`  Statuses:     ${formatCounts(summary.byStatus)}`);
  console.log(`  Channels:     ${formatCounts(summary.byChannelType)}`);
  console.log();
}

function formatCounts(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${key}=${count}`);
  return parts.length ? parts.join(", ") : "—";
}

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(deltaMs / 60_000);

  if (minutes < 1) return "updated <1m ago";
  if (minutes < 60) return `updated ${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `updated ${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `updated ${days}d ago`;
}
