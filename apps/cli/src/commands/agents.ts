import type { Command } from "commander";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentEntry {
  name: string;
  model: string;
  systemPrompt?: string;
  temperature: number;
  maxTokens: number;
  createdAt: string;
  isDefault: boolean;
}

interface AgentsStore {
  agents: AgentEntry[];
  defaultAgent: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const AGENTS_FILE = join(homedir(), ".karna", "agents.json");

// ─── Register Command ───────────────────────────────────────────────────────

export function registerAgentsCommand(program: Command): void {
  const agents = program
    .command("agents")
    .description("Manage AI agents");

  agents
    .command("list")
    .description("List configured agents")
    .action(async () => {
      await listAgents();
    });

  agents
    .command("add")
    .description("Create a new agent configuration")
    .requiredOption("-n, --name <name>", "Agent name")
    .option("-m, --model <model>", "AI model", "claude-sonnet-4-20250514")
    .option("-t, --temperature <temp>", "Temperature (0-2)", "0.7")
    .option("--max-tokens <tokens>", "Max output tokens", "4096")
    .option("-s, --system-prompt <prompt>", "System prompt")
    .option("-d, --default", "Set as default agent", false)
    .action(
      async (options: {
        name: string;
        model: string;
        temperature: string;
        maxTokens: string;
        systemPrompt?: string;
        default: boolean;
      }) => {
        await addAgent(options);
      },
    );

  agents
    .command("config <name>")
    .description("Show or edit agent configuration")
    .option("--model <model>", "Update AI model")
    .option("--temperature <temp>", "Update temperature")
    .option("--max-tokens <tokens>", "Update max tokens")
    .option("--system-prompt <prompt>", "Update system prompt")
    .option("--set-default", "Set as default agent", false)
    .action(
      async (
        name: string,
        options: {
          model?: string;
          temperature?: string;
          maxTokens?: string;
          systemPrompt?: string;
          setDefault: boolean;
        },
      ) => {
        await configAgent(name, options);
      },
    );

  agents
    .command("remove <name>")
    .description("Remove an agent configuration")
    .action(async (name: string) => {
      await removeAgent(name);
    });
}

// ─── List Agents ────────────────────────────────────────────────────────────

async function listAgents(): Promise<void> {
  const store = await loadAgentsStore();

  if (store.agents.length === 0) {
    console.log(chalk.yellow("\nNo agents configured."));
    console.log(chalk.dim('Create one with: karna agents add --name "My Agent"\n'));
    return;
  }

  console.log(chalk.bold("\nConfigured Agents\n"));

  for (const agent of store.agents) {
    const defaultBadge = agent.isDefault ? chalk.cyan(" [default]") : "";
    console.log(chalk.bold(`  ${agent.name}`) + defaultBadge);
    console.log(chalk.dim(`    Model:       ${agent.model}`));
    console.log(chalk.dim(`    Temperature: ${agent.temperature}`));
    console.log(chalk.dim(`    Max Tokens:  ${agent.maxTokens}`));
    if (agent.systemPrompt) {
      const truncated =
        agent.systemPrompt.length > 60
          ? agent.systemPrompt.slice(0, 60) + "..."
          : agent.systemPrompt;
      console.log(chalk.dim(`    Prompt:      ${truncated}`));
    }
    console.log(chalk.dim(`    Created:     ${agent.createdAt}`));
    console.log();
  }
}

// ─── Add Agent ──────────────────────────────────────────────────────────────

async function addAgent(options: {
  name: string;
  model: string;
  temperature: string;
  maxTokens: string;
  systemPrompt?: string;
  default: boolean;
}): Promise<void> {
  const spinner = ora(`Creating agent "${options.name}"...`).start();

  try {
    const store = await loadAgentsStore();

    // Check for duplicate names
    if (store.agents.some((a) => a.name === options.name)) {
      spinner.fail(`Agent "${options.name}" already exists`);
      return;
    }

    const temperature = parseFloat(options.temperature);
    if (isNaN(temperature) || temperature < 0 || temperature > 2) {
      spinner.fail("Temperature must be a number between 0 and 2");
      return;
    }

    const maxTokens = parseInt(options.maxTokens, 10);
    if (isNaN(maxTokens) || maxTokens <= 0) {
      spinner.fail("Max tokens must be a positive integer");
      return;
    }

    const agent: AgentEntry = {
      name: options.name,
      model: options.model,
      temperature,
      maxTokens,
      systemPrompt: options.systemPrompt,
      createdAt: new Date().toISOString(),
      isDefault: options.default || store.agents.length === 0,
    };

    if (agent.isDefault) {
      // Unset other defaults
      for (const a of store.agents) {
        a.isDefault = false;
      }
      store.defaultAgent = agent.name;
    }

    store.agents.push(agent);
    await saveAgentsStore(store);

    spinner.succeed(`Agent "${options.name}" created`);

    if (agent.isDefault) {
      console.log(chalk.dim("  Set as default agent."));
    }
    console.log();
  } catch (error) {
    spinner.fail(
      `Failed to create agent: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ─── Config Agent ───────────────────────────────────────────────────────────

async function configAgent(
  name: string,
  options: {
    model?: string;
    temperature?: string;
    maxTokens?: string;
    systemPrompt?: string;
    setDefault: boolean;
  },
): Promise<void> {
  const store = await loadAgentsStore();
  const agent = store.agents.find((a) => a.name === name);

  if (!agent) {
    console.log(chalk.red(`\nAgent "${name}" not found.\n`));
    return;
  }

  const hasUpdates =
    options.model ||
    options.temperature ||
    options.maxTokens ||
    options.systemPrompt ||
    options.setDefault;

  if (!hasUpdates) {
    // Show current config
    console.log(chalk.bold(`\nAgent: ${agent.name}\n`));
    console.log(chalk.dim("  Model:         ") + agent.model);
    console.log(chalk.dim("  Temperature:   ") + String(agent.temperature));
    console.log(chalk.dim("  Max Tokens:    ") + String(agent.maxTokens));
    console.log(
      chalk.dim("  System Prompt: ") + (agent.systemPrompt ?? chalk.dim("(none)")),
    );
    console.log(chalk.dim("  Default:       ") + (agent.isDefault ? "yes" : "no"));
    console.log(chalk.dim("  Created:       ") + agent.createdAt);
    console.log();
    return;
  }

  // Apply updates
  if (options.model) agent.model = options.model;
  if (options.temperature) {
    const temp = parseFloat(options.temperature);
    if (!isNaN(temp) && temp >= 0 && temp <= 2) agent.temperature = temp;
  }
  if (options.maxTokens) {
    const tokens = parseInt(options.maxTokens, 10);
    if (!isNaN(tokens) && tokens > 0) agent.maxTokens = tokens;
  }
  if (options.systemPrompt) agent.systemPrompt = options.systemPrompt;
  if (options.setDefault) {
    for (const a of store.agents) {
      a.isDefault = false;
    }
    agent.isDefault = true;
    store.defaultAgent = agent.name;
  }

  await saveAgentsStore(store);
  console.log(chalk.green(`\nAgent "${name}" updated.\n`));
}

// ─── Remove Agent ───────────────────────────────────────────────────────────

async function removeAgent(name: string): Promise<void> {
  const store = await loadAgentsStore();
  const index = store.agents.findIndex((a) => a.name === name);

  if (index === -1) {
    console.log(chalk.red(`\nAgent "${name}" not found.\n`));
    return;
  }

  const removed = store.agents.splice(index, 1)[0];
  if (removed?.isDefault && store.agents.length > 0) {
    store.agents[0]!.isDefault = true;
    store.defaultAgent = store.agents[0]!.name;
  }

  await saveAgentsStore(store);
  console.log(chalk.green(`\nAgent "${name}" removed.\n`));
}

// ─── Store Helpers ──────────────────────────────────────────────────────────

async function loadAgentsStore(): Promise<AgentsStore> {
  try {
    const raw = await readFile(AGENTS_FILE, "utf-8");
    return JSON.parse(raw) as AgentsStore;
  } catch {
    return { agents: [], defaultAgent: "" };
  }
}

async function saveAgentsStore(store: AgentsStore): Promise<void> {
  const dir = join(homedir(), ".karna");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(AGENTS_FILE, JSON.stringify(store, null, 2), "utf-8");
}
