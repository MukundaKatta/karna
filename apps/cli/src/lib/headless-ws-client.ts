/**
 * WebSocket-backed implementation of {@link HeadlessRuntimeClient}.
 *
 * Connects to the Karna gateway, sends a single prompt, aggregates the streamed
 * response into a final result, and auto-denies any tool approval requests
 * (headless mode cannot prompt the user). Kept separate from headless.ts so the
 * core logic stays transport-free and unit-testable.
 */

import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { ProtocolMessage } from "@karna/shared";
import type {
  HeadlessRuntimeClient,
  HeadlessRunResult,
  HeadlessToolEvent,
  HeadlessUsage,
} from "./headless.js";

export interface WebSocketHeadlessClientOptions {
  gatewayUrl: string;
  model?: string;
  /** Connection timeout in ms. Defaults to 10_000. */
  connectTimeoutMs?: number;
}

export class WebSocketHeadlessClient implements HeadlessRuntimeClient {
  readonly sessionId: string = randomUUID();
  private ws: WebSocket | null = null;
  private closed = false;

  constructor(private readonly options: WebSocketHeadlessClientOptions) {}

  async run(prompt: string, signal?: AbortSignal): Promise<HeadlessRunResult> {
    const ws = await this.connect();
    this.ws = ws;

    return new Promise<HeadlessRunResult>((resolve, reject) => {
      const tools: HeadlessToolEvent[] = [];
      let output = "";
      let finishReason: string | null = null;
      let usage: HeadlessUsage | null = null;
      let settled = false;

      const finish = (result: HeadlessRunResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const onAbort = (): void => {
        fail(new Error("Run aborted"));
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      ws.on("message", (data: WebSocket.RawData) => {
        let message: ProtocolMessage;
        try {
          message = JSON.parse(data.toString()) as ProtocolMessage;
        } catch {
          return;
        }
        if (!message || typeof message.type !== "string") return;

        switch (message.type) {
          case "connect.ack": {
            const chatMsg: ProtocolMessage = {
              id: randomUUID(),
              type: "chat.message",
              timestamp: Date.now(),
              sessionId: this.sessionId,
              payload: { content: prompt, role: "user" },
            };
            ws.send(JSON.stringify(chatMsg));
            break;
          }

          case "agent.response": {
            const payload = (message as { payload: { content: string; finishReason: string; usage?: HeadlessUsage } }).payload;
            output = payload.content;
            finishReason = payload.finishReason;
            if (payload.usage) {
              usage = { inputTokens: payload.usage.inputTokens, outputTokens: payload.usage.outputTokens };
            }
            finish({ output, finishReason, tools, usage, error: finishReason === "error" ? "Agent reported an error" : null });
            break;
          }

          case "agent.response.stream": {
            const payload = (message as { payload: { delta: string; finishReason: string | null } }).payload;
            output += payload.delta;
            if (payload.finishReason) {
              finishReason = payload.finishReason;
              finish({
                output,
                finishReason,
                tools,
                usage,
                error: payload.finishReason === "error" ? "Agent reported an error" : null,
              });
            }
            break;
          }

          case "tool.result": {
            const payload = (message as { payload: { toolName: string; isError: boolean; durationMs?: number } }).payload;
            tools.push({
              toolName: payload.toolName,
              isError: payload.isError,
              ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
            });
            break;
          }

          case "tool.approval.requested": {
            // Headless mode cannot prompt; auto-deny risky tools.
            const payload = (message as { payload: { toolCallId: string } }).payload;
            const response: ProtocolMessage = {
              id: randomUUID(),
              type: "tool.approval.response",
              timestamp: Date.now(),
              sessionId: this.sessionId,
              payload: {
                toolCallId: payload.toolCallId,
                approved: false,
                reason: "Auto-denied in headless mode",
              },
            };
            ws.send(JSON.stringify(response));
            break;
          }

          case "heartbeat.check": {
            const ack: ProtocolMessage = {
              id: randomUUID(),
              type: "heartbeat.ack",
              timestamp: Date.now(),
              sessionId: this.sessionId,
              payload: { clientTime: Date.now() },
            };
            ws.send(JSON.stringify(ack));
            break;
          }

          case "error": {
            const payload = (message as { payload: { code: string; message: string } }).payload;
            finish({ output, finishReason, tools, usage, error: `[${payload.code}] ${payload.message}` });
            break;
          }

          default:
            break;
        }
      });

      ws.on("close", () => {
        if (!settled) {
          fail(new Error("Gateway closed the connection before responding"));
        }
      });

      ws.on("error", (error: Error) => {
        fail(error);
      });

      // Kick off the session.
      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "cli",
          channelId: `cli-headless-${this.sessionId.slice(0, 8)}`,
          metadata: { model: this.options.model },
        },
      };
      ws.send(JSON.stringify(connectMsg));
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }

  private connect(): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.options.gatewayUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Connection timeout"));
      }, this.options.connectTimeoutMs ?? 10_000);

      ws.on("open", () => {
        clearTimeout(timeout);
        resolve(ws);
      });
      ws.once("error", (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
}
