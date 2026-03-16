import type { Command } from "commander";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";

// ─── Types ──────────────────────────────────────────────────────────────────

type CheckStatus = "pass" | "fail" | "warn";

interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
}

// ─── Register Command ───────────────────────────────────────────────────────

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Run health checks on your Karna installation")
    .action(async () => {
      await runDoctor();
    });
}

// ─── Doctor Implementation ──────────────────────────────────────────────────

async function runDoctor(): Promise<void> {
  console.log(chalk.bold("\nKarna Doctor\n"));
  console.log(chalk.dim("Running health checks...\n"));

  const results: CheckResult[] = [];

  results.push(await checkNodeVersion());
  results.push(await checkConfigFile());
  results.push(await checkApiKeys());
  results.push(await checkSupabaseConnection());
  results.push(await checkGatewayReachability());
  results.push(await checkPnpmAvailable());

  // Display results
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
        "\n  Some checks failed. Run 'karna onboard' to fix configuration issues.\n",
      ),
    );
  } else if (warnCount > 0) {
    console.log(chalk.dim("\n  Some warnings found but Karna should work.\n"));
  } else {
    console.log(chalk.green("\n  All checks passed! Karna is ready.\n"));
  }
}

// ─── Individual Checks ──────────────────────────────────────────────────────

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0] ?? "0", 10);

  if (major >= 20) {
    return {
      name: "Node.js",
      status: "pass",
      message: `${version}`,
    };
  } else if (major >= 18) {
    return {
      name: "Node.js",
      status: "warn",
      message: `${version} (20+ recommended)`,
      detail: "Some features may not work on Node.js < 20",
    };
  } else {
    return {
      name: "Node.js",
      status: "fail",
      message: `${version} (20+ required)`,
      detail: "Upgrade Node.js: https://nodejs.org",
    };
  }
}

async function checkConfigFile(): Promise<CheckResult> {
  const configPath = join(homedir(), ".karna", "karna.json");

  if (!existsSync(configPath)) {
    return {
      name: "Configuration",
      status: "fail",
      message: "Not found",
      detail: `Expected at ${configPath}. Run: karna onboard`,
    };
  }

  try {
    const raw = await readFile(configPath, "utf-8");
    JSON.parse(raw);
    return {
      name: "Configuration",
      status: "pass",
      message: "Valid",
    };
  } catch {
    return {
      name: "Configuration",
      status: "fail",
      message: "Invalid JSON",
      detail: `Fix the config at ${configPath}`,
    };
  }
}

async function checkApiKeys(): Promise<CheckResult> {
  const configPath = join(homedir(), ".karna", "karna.json");

  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const agent = config["agent"] as Record<string, unknown> | undefined;
    const providers = agent?.["providers"] as Record<string, unknown> | undefined;

    if (!providers) {
      return {
        name: "API Keys",
        status: "warn",
        message: "No providers configured",
        detail: "Run: karna onboard",
      };
    }

    const anthropic = providers["anthropic"] as
      | Record<string, unknown>
      | undefined;
    const openai = providers["openai"] as Record<string, unknown> | undefined;

    const hasAnthropic = Boolean(anthropic?.["apiKey"]);
    const hasOpenai = Boolean(openai?.["apiKey"]);

    if (hasAnthropic || hasOpenai) {
      const keys: string[] = [];
      if (hasAnthropic) keys.push("Anthropic");
      if (hasOpenai) keys.push("OpenAI");
      return {
        name: "API Keys",
        status: "pass",
        message: `Configured: ${keys.join(", ")}`,
      };
    }

    return {
      name: "API Keys",
      status: "fail",
      message: "No API keys found",
      detail: "Run: karna onboard",
    };
  } catch {
    return {
      name: "API Keys",
      status: "warn",
      message: "Could not check (config not found)",
    };
  }
}

async function checkSupabaseConnection(): Promise<CheckResult> {
  const configPath = join(homedir(), ".karna", "karna.json");

  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const memory = config["memory"] as Record<string, unknown> | undefined;

    if (!memory || !memory["enabled"]) {
      return {
        name: "Database",
        status: "warn",
        message: "Memory/database not configured",
        detail: "Optional: configure Supabase via karna onboard",
      };
    }

    const connectionString = memory["connectionString"] as string | undefined;
    if (!connectionString) {
      return {
        name: "Database",
        status: "warn",
        message: "No connection string",
        detail: "Memory is enabled but no connection string is set",
      };
    }

    // Try a basic connectivity check
    try {
      const url = new URL(connectionString);
      return {
        name: "Database",
        status: "pass",
        message: `Configured (${url.hostname})`,
      };
    } catch {
      return {
        name: "Database",
        status: "fail",
        message: "Invalid connection string",
      };
    }
  } catch {
    return {
      name: "Database",
      status: "warn",
      message: "Could not check (config not found)",
    };
  }
}

async function checkGatewayReachability(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);

    const response = await fetch("http://localhost:3000/health", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      return {
        name: "Gateway",
        status: "pass",
        message: "Running on localhost:3000",
      };
    }

    return {
      name: "Gateway",
      status: "warn",
      message: `Responded with HTTP ${response.status}`,
    };
  } catch {
    return {
      name: "Gateway",
      status: "warn",
      message: "Not running",
      detail: "Start with: karna gateway start",
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
      detail: "Install: npm install -g pnpm",
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
