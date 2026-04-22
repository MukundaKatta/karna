import type { Command } from "commander";
import chalk from "chalk";
import { runWizard } from "../onboard/wizard.js";

// ─── Register Command ───────────────────────────────────────────────────────

export function registerOnboardCommand(program: Command): void {
  program
    .command("onboard")
    .description("Set up Karna as your everyday AI assistant")
    .option("--skip-test", "Skip connection tests during setup", false)
    .action(async (options: { skipTest: boolean }) => {
      console.log(chalk.bold.cyan("\n  Welcome to Karna Setup\n"));
      console.log(
        chalk.dim(
          "  This wizard helps you turn Karna into a chat-first assistant for your daily work.\n",
        ),
      );

      try {
        await runWizard({ skipTest: options.skipTest });
        console.log(chalk.green.bold("\n  Setup complete! Karna is ready for its first conversation.\n"));
        console.log(chalk.dim("  Next steps:"));
        console.log(chalk.dim("    1. Start Karna:        karna gateway start"));
        console.log(chalk.dim("    2. Open a chat:        karna chat"));
        console.log(chalk.dim("    3. Check health:       karna status\n"));
      } catch (error) {
        console.error(
          chalk.red(
            `\nSetup failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exit(1);
      }
    });
}
