import type { Command } from "commander";
import chalk from "chalk";
import { resolveGatewayHttpUrl } from "../lib/config.js";
import {
  fetchTrace,
  fetchTraces,
  fetchTraceStats,
  type Trace,
  type TraceFilterOptions,
} from "../lib/traces.js";

interface TraceListFlags {
  session?: string;
  agent?: string;
  tool?: string;
  limit?: string;
  minDurationMs?: string;
  active?: boolean;
  errors?: boolean;
  success?: boolean;
  json?: boolean;
}

interface TraceStatsFlags {
  periodMs?: string;
  json?: boolean;
}

export function registerTracesCommand(program: Command): void {
  const traces = program
    .command("traces")
    .description("Inspect recent Karna traces and turn diagnostics")
    .option("-g, --gateway <url>", "Gateway URL");

  traces
    .command("list")
    .description("List recent traces")
    .option("-s, --session <id>", "Filter by session id")
    .option("-a, --agent <id>", "Filter by agent id")
    .option("-t, --tool <name>", "Filter by tool span name")
    .option("-l, --limit <count>", "Limit results", "20")
    .option("--min-duration-ms <ms>", "Only include traces at or above this duration")
    .option("--active", "Include active traces", false)
    .option("--errors", "Only include traces with errors", false)
    .option("--success", "Only include successful completed traces", false)
    .option("--json", "Print raw JSON", false)
    .action(async (options: TraceListFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(traces.opts().gateway as string | undefined);
      const result = await fetchTraces(gatewayUrl, buildTraceFilter(options));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.traces.length) {
        console.log(chalk.yellow("No traces matched the filters."));
        return;
      }

      console.log(chalk.bold(`\nRecent traces (${result.total})\n`));
      for (const trace of result.traces) {
        printTraceLine(trace);
      }
      console.log();
    });

  traces
    .command("slow")
    .description("Show slow recent traces")
    .option("-m, --min-duration-ms <ms>", "Minimum duration", "5000")
    .option("-l, --limit <count>", "Limit results", "10")
    .option("--json", "Print raw JSON", false)
    .action(async (options: TraceListFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(traces.opts().gateway as string | undefined);
      const result = await fetchTraces(gatewayUrl, {
        minDurationMs: options.minDurationMs ? Number(options.minDurationMs) : 5000,
        limit: options.limit ? Number(options.limit) : 10,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.traces.length) {
        console.log(chalk.green("No slow traces found in the current window."));
        return;
      }

      console.log(chalk.bold(`\nSlow traces (${result.total})\n`));
      for (const trace of result.traces) {
        printTraceLine(trace);
      }
      console.log();
    });

  traces
    .command("failures")
    .description("Show traces with errors")
    .option("-l, --limit <count>", "Limit results", "10")
    .option("--json", "Print raw JSON", false)
    .action(async (options: TraceListFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(traces.opts().gateway as string | undefined);
      const result = await fetchTraces(gatewayUrl, {
        hasErrors: true,
        includeActive: true,
        limit: options.limit ? Number(options.limit) : 10,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!result.traces.length) {
        console.log(chalk.green("No trace failures found."));
        return;
      }

      console.log(chalk.bold(`\nTrace failures (${result.total})\n`));
      for (const trace of result.traces) {
        printTraceLine(trace);
      }
      console.log();
    });

  traces
    .command("stats")
    .description("Show recent trace statistics")
    .option("--period-ms <ms>", "Stats window in milliseconds", "3600000")
    .option("--json", "Print raw JSON", false)
    .action(async (options: TraceStatsFlags) => {
      const gatewayUrl = await resolveGatewayHttpUrl(traces.opts().gateway as string | undefined);
      const stats = await fetchTraceStats(
        gatewayUrl,
        options.periodMs ? Number(options.periodMs) : 3_600_000,
      );

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(chalk.bold("\nTrace Stats\n"));
      console.log(`  Window:       ${formatDuration(stats.periodMs)}`);
      console.log(`  Traces:       ${stats.stats.totalTraces}`);
      console.log(`  Active:       ${stats.activeTraces}`);
      console.log(`  Avg:          ${formatDuration(stats.stats.avgDurationMs)}`);
      console.log(`  P95:          ${formatDuration(stats.stats.p95DurationMs)}`);
      console.log(`  Error rate:   ${(stats.stats.errorRate * 100).toFixed(1)}%`);
      console.log(`  Tool success: ${(stats.stats.toolSuccessRate * 100).toFixed(1)}%`);
      console.log(`  Throughput:   ${stats.stats.tracesPerMinute.toFixed(2)} traces/min`);
      console.log();
    });

  traces
    .command("show <traceId>")
    .description("Show detailed spans and events for a trace")
    .option("--json", "Print raw JSON", false)
    .action(async (traceId: string, options: { json?: boolean }) => {
      const gatewayUrl = await resolveGatewayHttpUrl(traces.opts().gateway as string | undefined);
      const trace = await fetchTrace(gatewayUrl, traceId);

      if (options.json) {
        console.log(JSON.stringify(trace, null, 2));
        return;
      }

      printTrace(trace);
    });
}

function buildTraceFilter(options: TraceListFlags): TraceFilterOptions {
  return {
    sessionId: options.session,
    agentId: options.agent,
    toolName: options.tool,
    limit: options.limit ? Number(options.limit) : 20,
    minDurationMs: options.minDurationMs ? Number(options.minDurationMs) : undefined,
    includeActive: options.active,
    hasErrors: options.errors,
    success: options.success ? true : undefined,
  };
}

function printTraceLine(trace: Trace): void {
  const status = trace.endedAt === undefined
    ? chalk.yellow("active")
    : trace.success
      ? chalk.green("ok")
      : chalk.red("error");
  const duration = formatDuration(trace.durationMs ?? Math.max(0, Date.now() - trace.startedAt));
  const tools = trace.toolCalls ? ` tools=${trace.toolCalls}` : "";
  console.log(
    `${chalk.bold(trace.traceId)}  ${status}  ${duration}  session=${trace.sessionId}  agent=${trace.agentId}${tools}`,
  );
}

function printTrace(trace: Trace): void {
  console.log(chalk.bold(`\nTrace ${trace.traceId}\n`));
  console.log(`  Session:      ${trace.sessionId}`);
  console.log(`  Agent:        ${trace.agentId}`);
  console.log(`  Status:       ${trace.endedAt === undefined ? "active" : trace.success ? "ok" : "error"}`);
  console.log(`  Started:      ${new Date(trace.startedAt).toLocaleString()}`);
  console.log(`  Duration:     ${formatDuration(trace.durationMs ?? Math.max(0, Date.now() - trace.startedAt))}`);
  console.log(`  Tokens:       ${trace.inputTokens + trace.outputTokens}`);
  console.log(`  Tool calls:   ${trace.toolCalls}`);
  console.log(`  Error:        ${trace.error ?? "—"}`);
  console.log();

  if (!trace.spans.length) {
    console.log(chalk.dim("  No spans recorded.\n"));
    return;
  }

  console.log(chalk.bold("Spans"));
  for (const span of trace.spans) {
    console.log(
      `  ${span.kind}/${span.name}  ${span.status}  ${formatDuration(span.durationMs ?? 0)}`,
    );
    if (Object.keys(span.attributes).length > 0) {
      console.log(chalk.dim(`    ${formatAttributes(span.attributes)}`));
    }
    for (const event of span.events) {
      console.log(
        chalk.dim(
          `    event ${event.name}${event.attributes ? ` (${formatAttributes(event.attributes)})` : ""}`,
        ),
      );
    }
  }
  console.log();
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function formatAttributes(attributes: Record<string, string | number | boolean>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}
