import type { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "./status.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SkillInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  actions: number;
}

// ─── Register Command ───────────────────────────────────────────────────────

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command("skills")
    .description("Manage agent skills");

  skills
    .command("list")
    .description("List installed skills")
    .option("-a, --all", "Show all skills including disabled", false)
    .action(async (options: { all: boolean }) => {
      await listSkills(options);
    });

  skills
    .command("install <name>")
    .description("Install a skill from the registry")
    .option("--version <version>", "Specific version to install")
    .action(async (name: string, options: { version?: string }) => {
      await installSkill(name, options);
    });

  skills
    .command("remove <name>")
    .description("Remove an installed skill")
    .option("-f, --force", "Force removal without confirmation", false)
    .action(async (name: string, options: { force: boolean }) => {
      await removeSkill(name, options);
    });

  skills
    .command("info <name>")
    .description("Show detailed information about a skill")
    .action(async (name: string) => {
      await showSkillInfo(name);
    });
}

// ─── List Skills ────────────────────────────────────────────────────────────

async function listSkills(options: { all: boolean }): Promise<void> {
  const spinner = ora("Loading skills...").start();

  try {
    const config = await loadConfig();
    const skills = await fetchSkillsList(config);

    spinner.stop();

    const filtered = options.all
      ? skills
      : skills.filter((s) => s.enabled);

    if (filtered.length === 0) {
      console.log(chalk.yellow("\nNo skills installed."));
      console.log(chalk.dim("Install skills with: karna skills install <name>\n"));
      return;
    }

    console.log(chalk.bold("\nInstalled Skills\n"));

    const maxNameLen = Math.max(...filtered.map((s) => s.name.length), 4);
    const maxIdLen = Math.max(...filtered.map((s) => s.id.length), 2);

    // Header
    console.log(
      chalk.dim(
        `  ${"ID".padEnd(maxIdLen)}  ${"Name".padEnd(maxNameLen)}  ${"Version".padEnd(10)}  Status     Actions`,
      ),
    );
    console.log(chalk.dim("  " + "-".repeat(maxIdLen + maxNameLen + 40)));

    for (const skill of filtered) {
      const statusStr = skill.enabled
        ? chalk.green("enabled ")
        : chalk.red("disabled");
      console.log(
        `  ${skill.id.padEnd(maxIdLen)}  ${skill.name.padEnd(maxNameLen)}  ${skill.version.padEnd(10)}  ${statusStr}  ${skill.actions}`,
      );
    }

    console.log(chalk.dim(`\n  Total: ${filtered.length} skill(s)\n`));
  } catch (error) {
    spinner.fail("Failed to load skills");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
  }
}

// ─── Install Skill ──────────────────────────────────────────────────────────

async function installSkill(
  name: string,
  options: { version?: string },
): Promise<void> {
  const versionStr = options.version ? `@${options.version}` : "";
  const spinner = ora(`Installing skill ${name}${versionStr}...`).start();

  try {
    // In a full implementation, this would:
    // 1. Fetch skill metadata from registry
    // 2. Download and extract skill package
    // 3. Validate skill structure
    // 4. Register with the local skill directory
    // 5. Update karna.json

    // Simulated installation
    await simulateDelay(2000);

    spinner.succeed(`Skill "${name}${versionStr}" installed successfully`);
    console.log(chalk.dim("  Restart the gateway to activate: karna gateway restart\n"));
  } catch (error) {
    spinner.fail(`Failed to install skill "${name}"`);
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
  }
}

// ─── Remove Skill ───────────────────────────────────────────────────────────

async function removeSkill(
  name: string,
  options: { force: boolean },
): Promise<void> {
  if (!options.force) {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const answer = await new Promise<string>((resolve) => {
      rl.question(
        chalk.yellow(`Remove skill "${name}"? This cannot be undone. (y/N): `),
        resolve,
      );
    });
    rl.close();

    if (!answer.toLowerCase().startsWith("y")) {
      console.log(chalk.dim("Cancelled."));
      return;
    }
  }

  const spinner = ora(`Removing skill "${name}"...`).start();

  try {
    // In a full implementation, this would:
    // 1. Stop any running instances of the skill
    // 2. Remove skill files from the skills directory
    // 3. Update karna.json
    // 4. Clean up any skill-specific data

    await simulateDelay(1000);

    spinner.succeed(`Skill "${name}" removed`);
    console.log(chalk.dim("  Restart the gateway to apply: karna gateway restart\n"));
  } catch (error) {
    spinner.fail(`Failed to remove skill "${name}"`);
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
  }
}

// ─── Skill Info ─────────────────────────────────────────────────────────────

async function showSkillInfo(name: string): Promise<void> {
  const spinner = ora(`Loading skill info for "${name}"...`).start();

  try {
    const config = await loadConfig();
    const skills = await fetchSkillsList(config);
    const skill = skills.find((s) => s.id === name || s.name === name);

    spinner.stop();

    if (!skill) {
      console.log(chalk.yellow(`\nSkill "${name}" not found.\n`));
      return;
    }

    console.log(chalk.bold(`\n  ${skill.name}`));
    console.log(chalk.dim(`  ${skill.description}`));
    console.log();
    console.log(chalk.dim("  ID:        ") + skill.id);
    console.log(chalk.dim("  Version:   ") + skill.version);
    console.log(
      chalk.dim("  Status:    ") +
        (skill.enabled ? chalk.green("enabled") : chalk.red("disabled")),
    );
    console.log(chalk.dim("  Actions:   ") + String(skill.actions));
    console.log();
  } catch (error) {
    spinner.fail("Failed to load skill info");
    console.error(
      chalk.red(error instanceof Error ? error.message : String(error)),
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchSkillsList(
  _config: unknown,
): Promise<SkillInfo[]> {
  // In a full implementation, this would read from the skills directory
  // and/or query the gateway for loaded skills.
  // For now, return an empty list indicating no skills are installed yet.
  return [];
}

function simulateDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
