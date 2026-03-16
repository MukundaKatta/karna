import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ModelSetupState {
  anthropicApiKey: string;
  anthropicBaseUrl?: string;
  fallbackModel?: string;
}

interface SetupOptions {
  skipTest: boolean;
}

// ─── Available Models ───────────────────────────────────────────────────────

const ANTHROPIC_MODELS = [
  { name: "Claude Sonnet 4 (recommended)", value: "claude-sonnet-4-20250514" },
  { name: "Claude Opus 4", value: "claude-opus-4-20250514" },
  { name: "Claude Haiku 3.5", value: "claude-3-5-haiku-20241022" },
];

const FALLBACK_OPTIONS = [
  { name: "No fallback", value: "" },
  { name: "Claude Haiku 3.5 (fast, cheap)", value: "claude-3-5-haiku-20241022" },
  { name: "Claude Sonnet 4", value: "claude-sonnet-4-20250514" },
];

// ─── Model Setup ────────────────────────────────────────────────────────────

export async function setupModel(
  state: ModelSetupState,
  options: SetupOptions,
): Promise<void> {
  console.log(chalk.bold("  Step 2: Configure AI Model\n"));

  const answers = await inquirer.prompt<{
    anthropicApiKey: string;
    useCustomBaseUrl: boolean;
    anthropicBaseUrl: string;
    defaultModel: string;
    fallbackModel: string;
  }>([
    {
      type: "password",
      name: "anthropicApiKey",
      message: "Anthropic API key:",
      mask: "*",
      validate: (input: string) => {
        if (!input.trim()) {
          return "API key is required for AI functionality";
        }
        if (!input.startsWith("sk-ant-")) {
          return 'Anthropic API keys typically start with "sk-ant-"';
        }
        return true;
      },
    },
    {
      type: "confirm",
      name: "useCustomBaseUrl",
      message: "Use a custom API base URL? (for proxies/self-hosted)",
      default: false,
    },
    {
      type: "input",
      name: "anthropicBaseUrl",
      message: "Custom API base URL:",
      when: (answers: { useCustomBaseUrl: boolean }) => answers.useCustomBaseUrl,
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
      type: "list",
      name: "defaultModel",
      message: "Default AI model:",
      choices: ANTHROPIC_MODELS,
      default: "claude-sonnet-4-20250514",
    },
    {
      type: "list",
      name: "fallbackModel",
      message: "Fallback model (used if primary fails):",
      choices: FALLBACK_OPTIONS,
      default: "",
    },
  ]);

  state.anthropicApiKey = answers.anthropicApiKey;
  state.anthropicBaseUrl = answers.anthropicBaseUrl || undefined;
  state.fallbackModel = answers.fallbackModel || undefined;

  // Test API key
  if (!options.skipTest) {
    await testApiKey(state.anthropicApiKey, state.anthropicBaseUrl);
  }

  console.log(chalk.green("  Model configuration complete.\n"));
}

// ─── API Key Test ───────────────────────────────────────────────────────────

async function testApiKey(
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const spinner = ora("  Verifying API key...").start();

  try {
    const url = baseUrl
      ? `${baseUrl}/v1/messages`
      : "https://api.anthropic.com/v1/messages";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 5,
        messages: [{ role: "user", content: "test" }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      spinner.succeed("API key verified successfully");
    } else if (response.status === 401) {
      spinner.fail("API key is invalid. You can fix this later in ~/.karna/karna.json");
    } else if (response.status === 400) {
      // The key is probably valid, just a bad request
      spinner.succeed("API key appears valid");
    } else if (response.status === 429) {
      spinner.warn("API key valid but rate limited. This is normal for new keys.");
    } else {
      spinner.warn(`API returned HTTP ${response.status}. You can verify later.`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      spinner.warn("API verification timed out. You can verify later.");
    } else {
      spinner.warn("Could not reach API. Check your network connection.");
    }
  }
}
