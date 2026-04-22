import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import type { DmAccessMode, GroupActivationMode } from "@karna/shared";
import { buildMentionNames, type SeededChannelAccessPolicy } from "../lib/access-policies.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChannelSetupState {
  agentName: string;
  telegramBotToken?: string;
  additionalChannels: string[];
  channelAccessPolicies: SeededChannelAccessPolicy[];
}

interface SetupOptions {
  skipTest: boolean;
}

// ─── Available Channels ─────────────────────────────────────────────────────

const CHANNEL_OPTIONS = [
  { name: "Telegram", value: "telegram", checked: true },
  { name: "WhatsApp (coming soon)", value: "whatsapp", disabled: true },
  { name: "Discord (coming soon)", value: "discord", disabled: true },
  { name: "Slack (coming soon)", value: "slack", disabled: true },
  { name: "Web Widget (coming soon)", value: "web", disabled: true },
];

// ─── Channel Setup ──────────────────────────────────────────────────────────

export async function setupChannels(
  state: ChannelSetupState,
  options: SetupOptions,
): Promise<void> {
  console.log(chalk.bold("  Step 3: Configure Channels\n"));

  const { selectedChannels } = await inquirer.prompt<{
    selectedChannels: string[];
  }>([
    {
      type: "checkbox",
      name: "selectedChannels",
      message: "Select channels to configure:",
      choices: CHANNEL_OPTIONS,
    },
  ]);

  // Configure Telegram if selected
  if (selectedChannels.includes("telegram")) {
    await configureTelegram(state, options);
  }

  // Track additional channels for future configuration
  state.additionalChannels = selectedChannels.filter(
    (ch) => ch !== "telegram",
  );

  if (selectedChannels.length === 0) {
    console.log(
      chalk.dim(
        "  No channels selected. You can add channels later with: karna onboard\n",
      ),
    );
  } else {
    console.log(chalk.green("  Channel configuration complete.\n"));
  }
}

// ─── Telegram Configuration ─────────────────────────────────────────────────

async function configureTelegram(
  state: ChannelSetupState,
  options: SetupOptions,
): Promise<void> {
  console.log(chalk.dim("\n  Telegram Bot Setup"));
  console.log(
    chalk.dim(
      "  Create a bot via @BotFather on Telegram to get your token.\n",
    ),
  );

  const { botToken } = await inquirer.prompt<{ botToken: string }>([
    {
      type: "password",
      name: "botToken",
      message: "Telegram bot token:",
      mask: "*",
      validate: (input: string) => {
        if (!input.trim()) {
          return "Bot token is required for Telegram integration";
        }
        // Basic Telegram bot token format: <number>:<alphanumeric>
        if (!/^\d+:[A-Za-z0-9_-]+$/.test(input.trim())) {
          return "Invalid bot token format. Expected format: 123456789:ABCDefghIJKLMnopQRSTuvwxYZ";
        }
        return true;
      },
    },
  ]);

  state.telegramBotToken = botToken;

  // Test bot token
  if (!options.skipTest) {
    await testTelegramToken(botToken);
  }

  const accessAnswers = await inquirer.prompt<{
    dmMode: DmAccessMode;
    groupActivation: GroupActivationMode;
  }>([
    {
      type: "list",
      name: "dmMode",
      message: "How should Telegram DMs be handled?",
      default: "pairing",
      choices: [
        {
          name: "Pairing (recommended) — unknown senders get an approval code first",
          value: "pairing",
        },
        {
          name: "Open — accept DMs from any sender",
          value: "open",
        },
        {
          name: "Closed — ignore DMs unless you explicitly allowlist the sender",
          value: "closed",
        },
      ],
    },
    {
      type: "list",
      name: "groupActivation",
      message: "How should Karna respond in Telegram groups?",
      default: "mention",
      choices: [
        {
          name: "Mention only (recommended) — respond when mentioned or replied to",
          value: "mention",
        },
        {
          name: "Always — respond to every group message",
          value: "always",
        },
        {
          name: "Off — stay silent in groups",
          value: "off",
        },
      ],
    },
  ]);

  state.channelAccessPolicies = state.channelAccessPolicies.filter(
    (policy) => policy.channelId !== "telegram",
  );
  state.channelAccessPolicies.push({
    channelId: "telegram",
    dmMode: accessAnswers.dmMode,
    groupActivation: accessAnswers.groupActivation,
    agentMentionNames: buildMentionNames(state.agentName),
  });

  console.log(
    chalk.dim(
      `  Telegram access set to DM=${accessAnswers.dmMode}, groups=${accessAnswers.groupActivation}.`,
    ),
  );
}

// ─── Token Test ─────────────────────────────────────────────────────────────

async function testTelegramToken(token: string): Promise<void> {
  const spinner = ora("  Verifying Telegram bot token...").start();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(
      `https://api.telegram.org/bot${token}/getMe`,
      { signal: controller.signal },
    );

    clearTimeout(timeout);

    if (response.ok) {
      const data = (await response.json()) as {
        ok: boolean;
        result: {
          id: number;
          is_bot: boolean;
          first_name: string;
          username: string;
        };
      };

      if (data.ok) {
        spinner.succeed(
          `Bot verified: @${data.result.username} (${data.result.first_name})`,
        );
      } else {
        spinner.fail("Bot token is invalid");
      }
    } else if (response.status === 401) {
      spinner.fail("Bot token is invalid. Get a new token from @BotFather.");
    } else {
      spinner.warn(`Telegram API returned HTTP ${response.status}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      spinner.warn("Telegram API verification timed out.");
    } else {
      spinner.warn("Could not reach Telegram API. Check your network.");
    }
  }
}
