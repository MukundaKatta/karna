import type { Command } from "commander";
import chalk from "chalk";
import { runWizard } from "../onboard/wizard.js";

// ─── Register Command ───────────────────────────────────────────────────────

export function registerOnboardCommand(program: Command): void {
  program
    .command("onboard")
    .description("Interactive setup wizard for Karna")
    .option("--skip-test", "Skip connection tests during setup", false)
    .action(async (options: { skipTest: boolean }) => {
      console.log(chalk.bold.cyan("\n  Welcome to Karna Setup Wizard\n"));
      console.log(
        chalk.dim(
          "  This wizard will guide you through configuring your AI agent platform.\n",
        ),
      );

      try {
        await runWizard({ skipTest: options.skipTest });
        console.log(chalk.green.bold("\n  Setup complete! You're ready to go.\n"));
        console.log(chalk.dim("  Next steps:"));
        console.log(chalk.dim("    1. Start the gateway:  karna gateway start"));
        console.log(chalk.dim("    2. Start chatting:     karna chat"));
        console.log(chalk.dim("    3. Check status:       karna status\n"));
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
