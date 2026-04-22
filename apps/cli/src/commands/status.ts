import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, resolveGatewayHttpUrl } from "../lib/config.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface HealthResponse {
  status: string;
  version?: string;
  uptime?: number;
  connections?: number;
  sessions?: number;
  model?: string;
}

// ─── Register Command ───────────────────────────────────────────────────────

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show system status and health information")
    .option("-g, --gateway <url>", "Gateway URL")
    .action(async (options: { gateway?: string }) => {
      await showStatus(options);
    });
}

// ─── Status Implementation ──────────────────────────────────────────────────

async function showStatus(options: { gateway?: string }): Promise<void> {
  console.log(chalk.bold("\nKarna System Status\n"));

  // Load config
  const config = await loadConfig();
  if (config) {
    console.log(chalk.dim("  Config:   ") + chalk.green("Found"));
    console.log(chalk.dim("  Env:      ") + config.env);
    console.log(chalk.dim("  Name:     ") + config.name);
  } else {
    console.log(
      chalk.dim("  Config:   ") + chalk.yellow("Not found (run: karna onboard)"),
    );
  }

  console.log();

  // Check gateway health
  const gatewayUrl = await resolveGatewayHttpUrl(options.gateway);
  const spinner = ora("Checking gateway...").start();

  try {
    const health = await fetchHealth(gatewayUrl);
    spinner.succeed("Gateway is running");
    console.log();
    console.log(chalk.dim("  Status:       ") + chalk.green(health.status));
    if (health.version) {
      console.log(chalk.dim("  Version:      ") + health.version);
    }
    if (health.uptime !== undefined) {
      console.log(
        chalk.dim("  Uptime:       ") + formatUptime(health.uptime),
      );
    }
    if (health.connections !== undefined) {
      console.log(
        chalk.dim("  Connections:  ") + String(health.connections),
      );
    }
    if (health.sessions !== undefined) {
      console.log(
        chalk.dim("  Sessions:     ") + String(health.sessions),
      );
    }
    if (health.model) {
      console.log(chalk.dim("  Model:        ") + health.model);
    }
  } catch {
    spinner.fail("Gateway is not reachable");
    console.log(
      chalk.yellow(
        "\n  Start the gateway with: karna gateway start\n",
      ),
    );
  }

  // Show channels
  if (config?.channels && config.channels.length > 0) {
    console.log(chalk.bold("\n  Channels:"));
    for (const channel of config.channels) {
      const statusIcon = channel.enabled
        ? chalk.green("enabled")
        : chalk.red("disabled");
      console.log(chalk.dim(`    - ${channel.type}: `) + statusIcon);
    }
  }

  console.log();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchHealth(baseUrl: string): Promise<HealthResponse> {
  const url = `${baseUrl}/health`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as HealthResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);

  return parts.join(" ");
}
