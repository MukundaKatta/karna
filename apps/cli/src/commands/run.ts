import type { Command } from "commander";
import { resolveGatewayWsUrl } from "../lib/config.js";
import { runHeadless, serializeEnvelope, DEFAULT_HEADLESS_TIMEOUT_MS } from "../lib/headless.js";
import { WebSocketHeadlessClient } from "../lib/headless-ws-client.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunOptions {
  gateway?: string;
  model?: string;
  timeout?: string;
  pretty?: boolean;
}

// ─── Register Command ───────────────────────────────────────────────────────

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run a single prompt headlessly and print a JSON result envelope")
    .argument("<prompt>", "The prompt to send to the agent")
    .option("-g, --gateway <url>", "Gateway WebSocket URL")
    .option("-m, --model <model>", "AI model to use")
    .option("-t, --timeout <ms>", "Overall run timeout in milliseconds")
    .option("--pretty", "Pretty-print the JSON envelope", false)
    .action(async (prompt: string, options: RunOptions) => {
      const gatewayUrl = await resolveGatewayWsUrl(options.gateway);
      const timeoutMs = parseTimeout(options.timeout);

      const client = new WebSocketHeadlessClient({
        gatewayUrl,
        model: options.model,
      });

      const { envelope, exitCode } = await runHeadless({
        prompt,
        client,
        timeoutMs,
      });

      process.stdout.write(serializeEnvelope(envelope, options.pretty ?? false) + "\n");
      process.exit(exitCode);
    });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseTimeout(value: string | undefined): number {
  if (!value) return DEFAULT_HEADLESS_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HEADLESS_TIMEOUT_MS;
  }
  return Math.floor(parsed);
}
