#!/usr/bin/env node

import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerChatCommand } from "./commands/chat.js";
import { registerOnboardCommand } from "./commands/onboard.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerGatewayCommand } from "./commands/gateway.js";
import { registerSkillsCommand } from "./commands/skills.js";
import { registerAgentsCommand } from "./commands/agents.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerAccessCommand } from "./commands/access.js";

// ─── Version ────────────────────────────────────────────────────────────────

async function getVersion(): Promise<string> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = join(__dirname, "..", "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as { version: string };
    return pkg.version;
  } catch {
    return "0.1.0";
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const version = await getVersion();

  const program = new Command()
    .name("karna")
    .description("Karna — Your Loyal AI Agent Platform CLI")
    .version(version, "-v, --version")
    .option("--verbose", "Enable verbose output", false);

  // Register all commands
  registerOnboardCommand(program);
  registerChatCommand(program);
  registerStatusCommand(program);
  registerGatewayCommand(program);
  registerSkillsCommand(program);
  registerAgentsCommand(program);
  registerDoctorCommand(program);
  registerAccessCommand(program);

  // Logs command (simple shortcut)
  program
    .command("logs")
    .description("View Karna gateway logs")
    .option("-f, --follow", "Follow log output", false)
    .option("-n, --lines <count>", "Number of lines to show", "50")
    .action(async (options: { follow: boolean; lines: string }) => {
      const { spawn } = await import("node:child_process");
      const { getConfigDir } = await import("./commands/gateway.js");

      const configDir = getConfigDir();
      const logFile = join(configDir, "gateway.log");

      const args = options.follow
        ? ["-f", "-n", options.lines, logFile]
        : ["-n", options.lines, logFile];

      const tail = spawn("tail", args, { stdio: "inherit" });
      tail.on("error", () => {
        console.error(`Log file not found at ${logFile}`);
        console.error("Start the gateway first with: karna gateway start");
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
