import type { Command } from "commander";
import chalk from "chalk";
import {
  auditAccessPolicies,
  getAccessManagedChannels,
  loadAccessPolicies,
} from "../lib/access-policies.js";
import { loadConfigWithStatus, resolveGatewayHttpUrl } from "../lib/config.js";
import { fetchSessionSummary } from "../lib/sessions.js";
import { fetchTraceStats } from "../lib/traces.js";

type CheckStatus = "pass" | "fail" | "warn";

interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run health checks on your Karna installation")
    .action(async () => {
      await runDoctor();
    });
}

async function runDoctor(): Promise<void> {
  console.log(chalk.bold("\nKarna Doctor\n"));
  console.log(chalk.dim("Running health checks...\n"));

  const loadedConfig = await loadConfigWithStatus();
  const loadedPolicies = await loadAccessPolicies();

  const results: CheckResult[] = [];
  results.push(checkNodeVersion());
  results.push(checkConfigFile(loadedConfig));
  results.push(checkApiKeys(loadedConfig));
  results.push(checkSupabaseConnection(loadedConfig));
  results.push(checkAccessPolicies(loadedConfig, loadedPolicies));
  results.push(await checkGatewayReachability());
  results.push(await checkSessionHealth());
  results.push(await checkObservability());
  results.push(await checkPnpmAvailable());

  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;

  for (const result of results) {
    const icon = getStatusIcon(result.status);
    const color = getStatusColor(result.status);
    console.log(`  ${icon} ${color(result.name)}: ${result.message}`);
    if (result.detail) {
      console.log(chalk.dim(`      ${result.detail}`));
    }

    if (result.status === "pass") passCount++;
    else if (result.status === "fail") failCount++;
    else warnCount++;
  }

  console.log();
  console.log(
    chalk.dim("  Summary: ") +
      chalk.green(`${passCount} passed`) +
      (warnCount > 0 ? chalk.yellow(`, ${warnCount} warnings`) : "") +
      (failCount > 0 ? chalk.red(`, ${failCount} failed`) : ""),
  );

  if (failCount > 0) {
    console.log(
      chalk.yellow(
        "\n  Some checks failed. Run 'karna onboard' to repair config, then re-run 'karna doctor'.\n",
      ),
    );
  } else if (warnCount > 0) {
    console.log(chalk.dim("\n  Karna should work, but the warnings above are worth fixing.\n"));
  } else {
    console.log(chalk.green("\n  All checks passed! Karna is ready.\n"));
  }
}

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0] ?? "0", 10);

  if (major >= 20) {
    return {
      name: "Node.js",
      status: "pass",
      message: version,
    };
  }

  if (major >= 18) {
    return {
      name: "Node.js",
      status: "warn",
      message: `${version} (20+ recommended)`,
      detail: "Some features may not work on Node.js < 20.",
    };
  }

  return {
    name: "Node.js",
    status: "fail",
    message: `${version} (20+ required)`,
    detail: "Upgrade Node.js from https://nodejs.org.",
  };
}

function checkConfigFile(
  loadedConfig: Awaited<ReturnType<typeof loadConfigWithStatus>>,
): CheckResult {
  if (!loadedConfig.exists) {
    return {
      name: "Configuration",
      status: "fail",
      message: "Not found",
      detail: `Expected at ${loadedConfig.path}. Run: karna onboard`,
    };
  }

  if (loadedConfig.parseError) {
    return {
      name: "Configuration",
      status: "fail",
      message: "Invalid JSON",
      detail: loadedConfig.parseError,
    };
  }

  if (loadedConfig.validationErrors.length > 0) {
    return {
      name: "Configuration",
      status: "fail",
      message: "Schema validation failed",
      detail: loadedConfig.validationErrors.join("; "),
    };
  }

  return {
    name: "Configuration",
    status: "pass",
    message: "Valid",
    detail: loadedConfig.path,
  };
}

function checkApiKeys(
  loadedConfig: Awaited<ReturnType<typeof loadConfigWithStatus>>,
): CheckResult {
  if (!loadedConfig.config) {
    return {
      name: "API Keys",
      status: "warn",
      message: "Could not check",
      detail: "Fix the configuration first.",
    };
  }

  const providers = loadedConfig.config.agent.providers;
  if (!providers) {
    return {
      name: "API Keys",
      status: "warn",
      message: "No providers configured",
      detail: "Run: karna onboard",
    };
  }

  const configured: string[] = [];
  if (providers.anthropic?.apiKey) configured.push("Anthropic");
  if (providers.openai?.apiKey) configured.push("OpenAI");

  if (configured.length === 0) {
    return {
      name: "API Keys",
      status: "fail",
      message: "No API keys found",
      detail: "Run: karna onboard",
    };
  }

  return {
    name: "API Keys",
    status: "pass",
    message: `Configured: ${configured.join(", ")}`,
  };
}

function checkSupabaseConnection(
  loadedConfig: Awaited<ReturnType<typeof loadConfigWithStatus>>,
): CheckResult {
  if (!loadedConfig.config) {
    return {
      name: "Database",
      status: "warn",
      message: "Could not check",
      detail: "Fix the configuration first.",
    };
  }

  const memory = loadedConfig.config.memory;
  if (!memory.enabled) {
    return {
      name: "Database",
      status: "warn",
      message: "Memory is disabled",
      detail: "Enable SQLite or Supabase memory if you want persistence.",
    };
  }

  if (memory.backend === "sqlite" && !memory.connectionString) {
    return {
      name: "Database",
      status: "pass",
      message: "SQLite memory enabled",
    };
  }

  if (!memory.connectionString) {
    return {
      name: "Database",
      status: "warn",
      message: `${memory.backend} selected but no connection string configured`,
    };
  }

  try {
    const url = new URL(memory.connectionString);
    return {
      name: "Database",
      status: "pass",
      message: `Configured (${memory.backend})`,
      detail: url.hostname,
    };
  } catch {
    return {
      name: "Database",
      status: "fail",
      message: "Invalid connection string",
    };
  }
}

function checkAccessPolicies(
  loadedConfig: Awaited<ReturnType<typeof loadConfigWithStatus>>,
  loadedPolicies: Awaited<ReturnType<typeof loadAccessPolicies>>,
): CheckResult {
  if (loadedPolicies.parseError) {
    return {
      name: "Channel Access",
      status: "fail",
      message: "Policy file is not valid JSON",
      detail: loadedPolicies.parseError,
    };
  }

  if (loadedPolicies.validationErrors.length > 0) {
    return {
      name: "Channel Access",
      status: "fail",
      message: "Policy file validation failed",
      detail: loadedPolicies.validationErrors.join("; "),
    };
  }

  if (!loadedConfig.config) {
    return {
      name: "Channel Access",
      status: "warn",
      message: "Could not audit channel policies",
      detail: "Fix the configuration first.",
    };
  }

  const enabledChannels = getAccessManagedChannels(
    loadedConfig.config.channels
      .filter((channel) => channel.enabled)
      .map((channel) => channel.type),
  );
  const audit = auditAccessPolicies(enabledChannels, loadedPolicies.policies);

  return {
    name: "Channel Access",
    status: audit.status,
    message: audit.message,
    detail: audit.detail,
  };
}

async function checkGatewayReachability(): Promise<CheckResult> {
  const gatewayUrl = await resolveGatewayHttpUrl();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);

    const response = await fetch(`${gatewayUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      return {
        name: "Gateway",
        status: "pass",
        message: `Running at ${gatewayUrl}`,
      };
    }

    return {
      name: "Gateway",
      status: "warn",
      message: `Responded with HTTP ${response.status}`,
      detail: gatewayUrl,
    };
  } catch {
    return {
      name: "Gateway",
      status: "warn",
      message: "Not running",
      detail: `Start with: karna gateway start (expected ${gatewayUrl})`,
    };
  }
}

async function checkSessionHealth(): Promise<CheckResult> {
  const gatewayUrl = await resolveGatewayHttpUrl();

  try {
    const summary = await fetchSessionSummary(gatewayUrl);

    if (summary.total === 0) {
      return {
        name: "Sessions",
        status: "pass",
        message: "No live sessions",
      };
    }

    if ((summary.byStatus["suspended"] ?? 0) > 0 || summary.staleSessions > 0) {
      return {
        name: "Sessions",
        status: "warn",
        message: `${summary.total} live, ${summary.staleSessions} stale, ${summary.byStatus["suspended"] ?? 0} suspended`,
        detail: "Run 'karna sessions summary' or 'karna sessions reset' if channels look stuck.",
      };
    }

    return {
      name: "Sessions",
      status: "pass",
      message: `${summary.total} live sessions look healthy`,
      detail: Object.keys(summary.byChannelType).length > 0
        ? Object.entries(summary.byChannelType).map(([channel, count]) => `${channel}=${count}`).join(", ")
        : undefined,
    };
  } catch {
    return {
      name: "Sessions",
      status: "warn",
      message: "Could not inspect live sessions",
      detail: `Start the gateway to enable session diagnostics (expected ${gatewayUrl})`,
    };
  }
}

async function checkPnpmAvailable(): Promise<CheckResult> {
  try {
    const { execSync } = await import("node:child_process");
    const version = execSync("pnpm --version").toString().trim();
    return {
      name: "pnpm",
      status: "pass",
      message: `v${version}`,
    };
  } catch {
    return {
      name: "pnpm",
      status: "warn",
      message: "Not found",
      detail: "Install with: npm install -g pnpm",
    };
  }
}

async function checkObservability(): Promise<CheckResult> {
  const gatewayUrl = await resolveGatewayHttpUrl();

  try {
    const traceStats = await fetchTraceStats(gatewayUrl, 3_600_000);

    if (traceStats.activeTraces > 10) {
      return {
        name: "Observability",
        status: "warn",
        message: `${traceStats.activeTraces} traces are still active`,
        detail: "Run 'karna traces failures' or 'karna traces list --active' to inspect stuck turns.",
      };
    }

    if (traceStats.stats.errorRate > 0.2) {
      return {
        name: "Observability",
        status: "warn",
        message: `High recent error rate (${(traceStats.stats.errorRate * 100).toFixed(1)}%)`,
        detail: "Run 'karna traces failures' to inspect recent failed turns.",
      };
    }

    if (traceStats.stats.totalTraces === 0) {
      return {
        name: "Observability",
        status: "warn",
        message: "No recent traces captured",
        detail: "Send a test message, then run 'karna traces stats' to verify trace capture.",
      };
    }

    return {
      name: "Observability",
      status: "pass",
      message: `${traceStats.stats.totalTraces} recent traces, p95 ${Math.round(traceStats.stats.p95DurationMs)}ms`,
      detail: `${(traceStats.stats.errorRate * 100).toFixed(1)}% errors, ${(traceStats.stats.toolSuccessRate * 100).toFixed(1)}% tool success`,
    };
  } catch {
    return {
      name: "Observability",
      status: "warn",
      message: "Trace API unavailable",
      detail: `Start the gateway to enable trace diagnostics (expected ${gatewayUrl})`,
    };
  }
}

function getStatusIcon(status: CheckStatus): string {
  switch (status) {
    case "pass":
      return chalk.green("[PASS]");
    case "fail":
      return chalk.red("[FAIL]");
    case "warn":
      return chalk.yellow("[WARN]");
  }
}

function getStatusColor(status: CheckStatus): typeof chalk {
  switch (status) {
    case "pass":
      return chalk.green;
    case "fail":
      return chalk.red;
    case "warn":
      return chalk.yellow;
  }
}
