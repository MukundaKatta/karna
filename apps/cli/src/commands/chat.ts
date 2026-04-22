import type { Command } from "commander";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import chalk from "chalk";
import ora from "ora";
import type { ProtocolMessage } from "@karna/shared";
import { resolveGatewayWsUrl } from "../lib/config.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatOptions {
  gateway?: string;
  model?: string;
}

// ─── Register Command ───────────────────────────────────────────────────────

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Start an interactive chat session with Karna")
    .option("-g, --gateway <url>", "Gateway WebSocket URL")
    .option("-m, --model <model>", "AI model to use")
    .action(async (options: ChatOptions) => {
      await startChat(options);
    });
}

// ─── Chat Implementation ────────────────────────────────────────────────────

async function startChat(options: ChatOptions): Promise<void> {
  const gatewayUrl = await resolveGatewayWsUrl(options.gateway);

  console.log(chalk.bold("\nKarna Interactive Chat"));
  console.log(chalk.dim("Type your message and press Enter. Ctrl+C to exit.\n"));

  const spinner = ora("Connecting to gateway...").start();

  let ws: WebSocket;
  try {
    ws = await connectToGateway(gatewayUrl);
    spinner.succeed("Connected to gateway");
  } catch (error) {
    spinner.fail(
      `Failed to connect to gateway at ${gatewayUrl}`,
    );
    console.error(
      chalk.red(
        error instanceof Error ? error.message : String(error),
      ),
    );
    console.log(
      chalk.yellow("\nMake sure the gateway is running: karna gateway start"),
    );
    process.exit(1);
  }

  const sessionId = randomUUID();
  let isStreaming = false;
  let streamBuffer = "";

  // Send connect message
  const connectMsg: ProtocolMessage = {
    id: randomUUID(),
    type: "connect",
    timestamp: Date.now(),
    payload: {
      channelType: "cli",
      channelId: `cli-${sessionId.slice(0, 8)}`,
      metadata: { model: options.model },
    },
  };
  ws.send(JSON.stringify(connectMsg));

  // Handle incoming messages
  ws.on("message", (data: WebSocket.RawData) => {
    let message: ProtocolMessage;
    try {
      message = JSON.parse(data.toString()) as ProtocolMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case "connect.ack":
        console.log(chalk.green("Session established.\n"));
        break;

      case "agent.response": {
        if (message.type !== "agent.response") break;
        if (isStreaming) {
          process.stdout.write("\n");
          isStreaming = false;
          streamBuffer = "";
        }
        const content = (message as { payload: { content: string } }).payload.content;
        console.log(chalk.cyan("\nKarna: ") + content + "\n");
        break;
      }

      case "agent.response.stream": {
        if (message.type !== "agent.response.stream") break;
        const payload = (message as { payload: { delta: string; finishReason: string | null } }).payload;
        if (!isStreaming) {
          process.stdout.write(chalk.cyan("\nKarna: "));
          isStreaming = true;
        }
        process.stdout.write(payload.delta);
        streamBuffer += payload.delta;

        if (payload.finishReason) {
          process.stdout.write("\n\n");
          isStreaming = false;
          streamBuffer = "";
        }
        break;
      }

      case "status": {
        if (message.type !== "status") break;
        const statusPayload = (message as { payload: { state: string; message?: string } }).payload;
        if (statusPayload.state === "thinking") {
          process.stdout.write(chalk.dim("  [thinking...] "));
        } else if (statusPayload.state === "tool_calling") {
          process.stdout.write(
            chalk.yellow(`  [calling tool] ${statusPayload.message ?? ""}\n`),
          );
        }
        break;
      }

      case "tool.approval.requested": {
        if (message.type !== "tool.approval.requested") break;
        const toolPayload = (message as {
          payload: { toolName: string; riskLevel: string; description?: string; toolCallId: string };
        }).payload;

        console.log(chalk.yellow.bold("\n  Tool Approval Required"));
        console.log(chalk.yellow(`  Tool: ${toolPayload.toolName}`));
        console.log(chalk.yellow(`  Risk: ${toolPayload.riskLevel}`));
        if (toolPayload.description) {
          console.log(chalk.yellow(`  Description: ${toolPayload.description}`));
        }

        const approveRl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        approveRl.question(
          chalk.yellow("  Approve? (y/n): "),
          (answer: string) => {
            const approved = answer.toLowerCase().startsWith("y");
            const response: ProtocolMessage = {
              id: randomUUID(),
              type: "tool.approval.response",
              timestamp: Date.now(),
              sessionId,
              payload: {
                toolCallId: toolPayload.toolCallId,
                approved,
                reason: approved ? "User approved" : "User denied",
              },
            };
            ws.send(JSON.stringify(response));
            console.log(
              approved
                ? chalk.green("  Approved.\n")
                : chalk.red("  Denied.\n"),
            );
            approveRl.close();
          },
        );
        break;
      }

      case "tool.result": {
        if (message.type !== "tool.result") break;
        const resultPayload = (message as {
          payload: { toolName: string; isError: boolean; durationMs?: number };
        }).payload;
        const icon = resultPayload.isError ? chalk.red("x") : chalk.green("v");
        const duration = resultPayload.durationMs
          ? ` (${resultPayload.durationMs}ms)`
          : "";
        console.log(
          chalk.dim(`  [${icon}] ${resultPayload.toolName}${duration}`),
        );
        break;
      }

      case "error": {
        if (message.type !== "error") break;
        const errorPayload = (message as {
          payload: { code: string; message: string };
        }).payload;
        console.log(
          chalk.red(`\nError [${errorPayload.code}]: ${errorPayload.message}\n`),
        );
        break;
      }

      case "heartbeat.check": {
        const ack: ProtocolMessage = {
          id: randomUUID(),
          type: "heartbeat.ack",
          timestamp: Date.now(),
          sessionId,
          payload: { clientTime: Date.now() },
        };
        ws.send(JSON.stringify(ack));
        break;
      }

      default:
        break;
    }
  });

  ws.on("close", () => {
    console.log(chalk.yellow("\nDisconnected from gateway."));
    process.exit(0);
  });

  ws.on("error", (error: Error) => {
    console.error(chalk.red(`\nWebSocket error: ${error.message}`));
  });

  // Setup readline for user input
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green("You: "),
  });

  rl.prompt();

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === "/quit" || trimmed.toLowerCase() === "/exit") {
      console.log(chalk.dim("Goodbye!"));
      ws.close();
      rl.close();
      return;
    }

    const chatMsg: ProtocolMessage = {
      id: randomUUID(),
      type: "chat.message",
      timestamp: Date.now(),
      sessionId,
      payload: {
        content: trimmed,
        role: "user",
      },
    };

    ws.send(JSON.stringify(chatMsg));
  });

  rl.on("close", () => {
    console.log(chalk.dim("\nSession ended."));
    ws.close();
    process.exit(0);
  });

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log(chalk.dim("\n\nGoodbye!"));
    ws.close();
    rl.close();
    process.exit(0);
  });
}

// ─── WebSocket Connection ───────────────────────────────────────────────────

function connectToGateway(url: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url);

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Connection timeout (10s)"));
    }, 10_000);

    ws.on("open", () => {
      clearTimeout(timeout);
      resolve(ws);
    });

    ws.on("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
