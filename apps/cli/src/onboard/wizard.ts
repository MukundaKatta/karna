import inquirer from "inquirer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import type { KarnaConfig } from "@karna/shared";
import { seedAccessPolicies, type SeededChannelAccessPolicy } from "../lib/access-policies.js";
import { setupModel } from "./model-setup.js";
import { setupChannels } from "./channel-setup.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface WizardOptions {
  skipTest: boolean;
}

interface WizardState {
  agentName: string;
  anthropicApiKey: string;
  anthropicBaseUrl?: string;
  fallbackModel?: string;
  telegramBotToken?: string;
  additionalChannels: string[];
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceKey?: string;
  gatewayPort: number;
  channelAccessPolicies: SeededChannelAccessPolicy[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".karna");
const CONFIG_FILE = join(CONFIG_DIR, "karna.json");

// ─── Main Wizard ────────────────────────────────────────────────────────────

export async function runWizard(options: WizardOptions): Promise<void> {
  const state: WizardState = {
    agentName: "",
    anthropicApiKey: "",
    additionalChannels: [],
    gatewayPort: 3000,
    channelAccessPolicies: [],
  };

  // Step 1: Welcome + name your agent
  await stepWelcome(state);

  // Step 2: Configure AI model
  await setupModel(state, options);

  // Step 3: Configure channels
  await setupChannels(state, options);

  // Step 4: Configure database (Supabase)
  await stepDatabase(state);

  // Step 5: Write config
  await writeConfig(state);

  // Step 6: Test connections (if not skipped)
  if (!options.skipTest) {
    await testConnections(state);
  }
}

// ─── Step 1: Welcome ────────────────────────────────────────────────────────

async function stepWelcome(state: WizardState): Promise<void> {
  console.log(chalk.bold("  Step 1: Name Your Agent\n"));

  const answers = await inquirer.prompt<{ agentName: string; gatewayPort: number }>([
    {
      type: "input",
      name: "agentName",
      message: "What would you like to name your agent?",
      default: "Karna",
      validate: (input: string) =>
        input.trim().length > 0 ? true : "Agent name cannot be empty",
    },
    {
      type: "number",
      name: "gatewayPort",
      message: "Gateway port:",
      default: 3000,
      validate: (input: number) =>
        input > 0 && input < 65536 ? true : "Port must be between 1 and 65535",
    },
  ]);

  state.agentName = answers.agentName;
  state.gatewayPort = answers.gatewayPort;

  console.log(chalk.green(`\n  Agent "${state.agentName}" it is!\n`));
}

// ─── Step 4: Database ───────────────────────────────────────────────────────

async function stepDatabase(state: WizardState): Promise<void> {
  console.log(chalk.bold("  Step 4: Configure Database (Optional)\n"));

  const { configureDb } = await inquirer.prompt<{ configureDb: boolean }>([
    {
      type: "confirm",
      name: "configureDb",
      message: "Configure Supabase for persistent memory?",
      default: false,
    },
  ]);

  if (!configureDb) {
    console.log(chalk.dim("  Skipping database setup. Using SQLite by default.\n"));
    return;
  }

  const answers = await inquirer.prompt<{
    supabaseUrl: string;
    supabaseAnonKey: string;
    supabaseServiceKey: string;
  }>([
    {
      type: "input",
      name: "supabaseUrl",
      message: "Supabase project URL:",
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return "Please enter a valid URL";
        }
      },
    },
    {
      type: "password",
      name: "supabaseAnonKey",
      message: "Supabase anon (public) key:",
      mask: "*",
      validate: (input: string) =>
        input.trim().length > 0 ? true : "Anon key is required",
    },
    {
      type: "password",
      name: "supabaseServiceKey",
      message: "Supabase service role key:",
      mask: "*",
      validate: (input: string) =>
        input.trim().length > 0 ? true : "Service key is required",
    },
  ]);

  state.supabaseUrl = answers.supabaseUrl;
  state.supabaseAnonKey = answers.supabaseAnonKey;
  state.supabaseServiceKey = answers.supabaseServiceKey;

  console.log(chalk.green("  Supabase configured.\n"));
}

// ─── Write Config ───────────────────────────────────────────────────────────

async function writeConfig(state: WizardState): Promise<void> {
  const spinner = ora("Writing configuration...").start();

  try {
    // Ensure config directory exists
    if (!existsSync(CONFIG_DIR)) {
      await mkdir(CONFIG_DIR, { recursive: true });
    }

    const config: KarnaConfig = {
      name: state.agentName,
      env: "development",
      gateway: {
        port: state.gatewayPort,
        host: "0.0.0.0",
        cors: { origins: ["*"], credentials: true },
        websocket: {
          path: "/ws",
          heartbeatIntervalMs: 30_000,
          heartbeatTimeoutMs: 10_000,
          maxPayloadBytes: 1_048_576,
          maxConnectionsPerIp: 10,
        },
        rateLimit: {
          windowMs: 60_000,
          maxRequests: 60,
        },
      },
      agent: {
        defaultModel: "claude-sonnet-4-20250514",
        maxTokens: 4096,
        temperature: 0.7,
        maxTurns: 20,
        toolApproval: {
          autoApproveBelow: "low",
          timeoutMs: 120_000,
        },
        providers: {
          anthropic: state.anthropicApiKey
            ? {
                apiKey: state.anthropicApiKey,
                baseUrl: state.anthropicBaseUrl,
                maxRetries: 3,
              }
            : undefined,
        },
      },
      channels: buildChannelsConfig(state),
      memory: state.supabaseUrl
        ? {
            enabled: true,
            backend: "postgres",
            connectionString: state.supabaseUrl,
            maxEntriesPerSession: 1000,
            embedding: {
              enabled: false,
              model: "text-embedding-3-small",
              dimensions: 1536,
            },
          }
        : {
            enabled: true,
            backend: "sqlite",
            maxEntriesPerSession: 1000,
            embedding: {
              enabled: false,
              model: "text-embedding-3-small",
              dimensions: 1536,
            },
          },
      logging: {
        level: "info",
        pretty: true,
        redact: ["*.apiKey", "*.token", "*.secret", "*.password"],
      },
      skills: {
        directory: "./skills",
        autoLoad: true,
      },
    };

    await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
    await seedAccessPolicies(state.channelAccessPolicies);

    spinner.succeed(`Configuration written to ${CONFIG_FILE}`);
  } catch (error) {
    spinner.fail("Failed to write configuration");
    throw error;
  }
}

function buildChannelsConfig(
  state: WizardState,
): KarnaConfig["channels"] {
  const channels: KarnaConfig["channels"] = [];

  if (state.telegramBotToken) {
    channels.push({
      type: "telegram",
      enabled: true,
      settings: {
        botToken: state.telegramBotToken,
      },
    });
  }

  for (const channel of state.additionalChannels) {
    channels.push({
      type: channel,
      enabled: false,
      settings: {},
    });
  }

  return channels;
}

// ─── Test Connections ───────────────────────────────────────────────────────

async function testConnections(state: WizardState): Promise<void> {
  console.log(chalk.bold("\n  Testing connections...\n"));

  // Test Anthropic API key
  if (state.anthropicApiKey) {
    const spinner = ora("  Testing Anthropic API key...").start();
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": state.anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });

      if (response.ok || response.status === 400) {
        // 400 might be a model issue but the key is valid
        spinner.succeed("Anthropic API key is valid");
      } else if (response.status === 401) {
        spinner.fail("Anthropic API key is invalid");
      } else {
        spinner.warn(`Anthropic API returned HTTP ${response.status}`);
      }
    } catch {
      spinner.warn("Could not reach Anthropic API (network issue?)");
    }
  }

  // Test Telegram bot token
  if (state.telegramBotToken) {
    const spinner = ora("  Testing Telegram bot token...").start();
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${state.telegramBotToken}/getMe`,
      );
      if (response.ok) {
        const data = (await response.json()) as {
          result: { username: string };
        };
        spinner.succeed(
          `Telegram bot connected: @${data.result.username}`,
        );
      } else {
        spinner.fail("Telegram bot token is invalid");
      }
    } catch {
      spinner.warn("Could not reach Telegram API (network issue?)");
    }
  }
}
