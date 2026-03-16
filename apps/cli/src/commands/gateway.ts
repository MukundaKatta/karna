import type { Command } from "commander";
import { spawn } from "node:child_process";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".karna");
const PID_FILE = join(CONFIG_DIR, "gateway.pid");
const LOG_FILE = join(CONFIG_DIR, "gateway.log");

// ─── Exports ────────────────────────────────────────────────────────────────

export function getConfigDir(): string {
  return CONFIG_DIR;
}

// ─── Register Command ───────────────────────────────────────────────────────

export function registerGatewayCommand(program: Command): void {
  const gateway = program
    .command("gateway")
    .description("Manage the Karna gateway process");

  gateway
    .command("start")
    .description("Start the gateway process")
    .option("-p, --port <port>", "Port to listen on", "3000")
    .option("-d, --detach", "Run in background (detached)", false)
    .action(async (options: { port: string; detach: boolean }) => {
      await startGateway(options);
    });

  gateway
    .command("stop")
    .description("Stop the running gateway process")
    .action(async () => {
      await stopGateway();
    });

  gateway
    .command("restart")
    .description("Restart the gateway process")
    .option("-p, --port <port>", "Port to listen on", "3000")
    .action(async (options: { port: string }) => {
      await stopGateway();
      await startGateway({ ...options, detach: true });
    });

  gateway
    .command("status")
    .description("Check if the gateway process is running")
    .action(async () => {
      await gatewayStatus();
    });
}

// ─── Gateway Start ──────────────────────────────────────────────────────────

async function startGateway(options: {
  port: string;
  detach: boolean;
}): Promise<void> {
  // Check if already running
  const existingPid = await readPid();
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(
      chalk.yellow(
        `Gateway is already running (PID: ${existingPid}). Use 'karna gateway stop' first.`,
      ),
    );
    return;
  }

  await ensureConfigDir();

  const spinner = ora("Starting gateway...").start();

  const env = {
    ...process.env,
    PORT: options.port,
    NODE_ENV: process.env["NODE_ENV"] ?? "development",
  };

  if (options.detach) {
    // Run detached
    const logFd = await import("node:fs").then((fs) =>
      fs.openSync(LOG_FILE, "a"),
    );

    const child = spawn("node", ["node_modules/@karna/gateway/dist/index.js"], {
      cwd: process.cwd(),
      env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });

    child.unref();

    if (child.pid) {
      await writePid(child.pid);
      spinner.succeed(
        `Gateway started (PID: ${child.pid}, port: ${options.port})`,
      );
      console.log(chalk.dim(`  Logs: ${LOG_FILE}`));
    } else {
      spinner.fail("Failed to start gateway");
    }
  } else {
    // Run in foreground
    spinner.succeed(`Starting gateway on port ${options.port} (foreground)`);

    const child = spawn("node", ["node_modules/@karna/gateway/dist/index.js"], {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });

    if (child.pid) {
      await writePid(child.pid);
    }

    child.on("exit", async (code) => {
      await cleanupPid();
      if (code !== null && code !== 0) {
        console.error(chalk.red(`Gateway exited with code ${code}`));
      }
    });

    // Forward signals
    const handleSignal = () => {
      child.kill("SIGTERM");
    };
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);

    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
    });
  }
}

// ─── Gateway Stop ───────────────────────────────────────────────────────────

async function stopGateway(): Promise<void> {
  const pid = await readPid();

  if (!pid) {
    console.log(chalk.yellow("No gateway PID file found. Gateway may not be running."));
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log(chalk.yellow(`Gateway process (PID: ${pid}) is not running. Cleaning up.`));
    await cleanupPid();
    return;
  }

  const spinner = ora(`Stopping gateway (PID: ${pid})...`).start();

  try {
    process.kill(pid, "SIGTERM");

    // Wait for process to exit (up to 10 seconds)
    let waited = 0;
    while (isProcessRunning(pid) && waited < 10_000) {
      await sleep(500);
      waited += 500;
    }

    if (isProcessRunning(pid)) {
      // Force kill
      process.kill(pid, "SIGKILL");
      spinner.warn("Gateway force-killed (did not stop gracefully)");
    } else {
      spinner.succeed("Gateway stopped");
    }
  } catch (error) {
    spinner.fail(
      `Failed to stop gateway: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await cleanupPid();
}

// ─── Gateway Status ─────────────────────────────────────────────────────────

async function gatewayStatus(): Promise<void> {
  const pid = await readPid();

  if (!pid) {
    console.log(chalk.yellow("Gateway: ") + chalk.red("Not running") + chalk.dim(" (no PID file)"));
    return;
  }

  if (isProcessRunning(pid)) {
    console.log(chalk.yellow("Gateway: ") + chalk.green("Running") + chalk.dim(` (PID: ${pid})`));
  } else {
    console.log(chalk.yellow("Gateway: ") + chalk.red("Not running") + chalk.dim(` (stale PID: ${pid})`));
    await cleanupPid();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function ensureConfigDir(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
}

async function readPid(): Promise<number | null> {
  try {
    const content = await readFile(PID_FILE, "utf-8");
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

async function writePid(pid: number): Promise<void> {
  await ensureConfigDir();
  await writeFile(PID_FILE, String(pid), "utf-8");
}

async function cleanupPid(): Promise<void> {
  try {
    await unlink(PID_FILE);
  } catch {
    // File may not exist
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
