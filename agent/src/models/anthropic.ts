// ─── Anthropic (Claude) Model Provider ─────────────────────────────────────

import Anthropic from "@anthropic-ai/sdk";
import type { Tool, MessageParam, ContentBlock } from "@anthropic-ai/sdk/resources/messages.js";
import pino from "pino";
import type { ChatParams, ChatTool, ModelProvider, StreamEvent } from "./provider.js";

const logger = pino({ name: "anthropic-provider" });

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 4096;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Anthropic Claude provider implementing the ModelProvider interface.
 * Handles streaming responses, tool use, and retries for rate limits.
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
    });
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamEvent> {
    const model = params.model ?? DEFAULT_MODEL;
    const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;
    const messages = this.buildMessages(params);
    const tools = params.tools ? this.buildTools(params.tools) : undefined;

    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      try {
        const stream = this.client.messages.stream({
          model,
          max_tokens: maxTokens,
          messages,
          system: params.systemPrompt ?? undefined,
          temperature: params.temperature ?? undefined,
          stop_sequences: params.stopSequences ?? undefined,
          tools: tools && tools.length > 0 ? tools : undefined,
        });

        yield* this.processStream(stream);
        return;
      } catch (error: unknown) {
        attempt++;

        if (this.isRateLimitError(error) && attempt < MAX_RETRIES) {
          const delay = this.getRetryDelay(error, attempt);
          logger.warn({ attempt, delay, model }, "Rate limited, retrying");
          await this.sleep(delay);
          continue;
        }

        if (this.isContextOverflowError(error)) {
          logger.error({ model }, "Context window overflow");
          throw new AgentModelError(
            "CONTEXT_OVERFLOW",
            "Message exceeds model context window. Reduce conversation history or memory context.",
            error
          );
        }

        if (this.isAuthError(error)) {
          throw new AgentModelError(
            "AUTH_ERROR",
            "Invalid or missing Anthropic API key.",
            error
          );
        }

        logger.error({ error, attempt, model }, "Anthropic API call failed");
        throw new AgentModelError(
          "PROVIDER_ERROR",
          `Anthropic API error after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }
    }
  }

  countTokens(text: string): number {
    // Rough approximation: ~4 chars per token for English text.
    // Use the Anthropic token counting API for precision in production.
    return Math.ceil(text.length / 4);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private buildMessages(params: ChatParams): MessageParam[] {
    const messages: MessageParam[] = [];

    for (const msg of params.messages) {
      if (msg.role === "system") {
        // System messages are handled via the system parameter, skip here.
        continue;
      }

      if (msg.role === "tool") {
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId ?? "",
              content: msg.content,
            },
          ],
        });
        continue;
      }

      if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content });
        continue;
      }

      // Assistant messages
      messages.push({ role: "assistant", content: msg.content });
    }

    return messages;
  }

  private buildTools(tools: ChatTool[]): Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: "object" as const,
        properties: tool.parameters.properties ?? {},
        required: tool.parameters.required ?? [],
      },
    }));
  }

  private async *processStream(stream: ReturnType<Anthropic["messages"]["stream"]>): AsyncGenerator<StreamEvent> {
    const events = stream.on("message", () => {});

    for await (const event of events) {
      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if ("text" in delta && delta.type === "text_delta") {
          yield { type: "text", text: delta.text };
        } else if (delta.type === "input_json_delta" && "partial_json" in delta) {
          // JSON delta for tool input, accumulated by SDK
        }
      }

      if (event.type === "content_block_stop") {
        const block: ContentBlock = (stream as unknown as { currentMessage: { content: ContentBlock[] } })
          .currentMessage?.content?.[event.index];
        if (block && block.type === "tool_use") {
          yield {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          };
        }
      }

      if (event.type === "message_delta") {
        // Message is finishing
      }

      if (event.type === "message_stop") {
        break;
      }
    }

    // Emit usage from the final message
    const finalMessage = await stream.finalMessage();
    yield {
      type: "usage",
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    };

    yield { type: "done" };
  }

  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Anthropic.RateLimitError) return true;
    if (error instanceof Error && error.message.includes("rate_limit")) return true;
    return false;
  }

  private isContextOverflowError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return msg.includes("context") && (msg.includes("overflow") || msg.includes("too long"));
    }
    return false;
  }

  private isAuthError(error: unknown): boolean {
    if (error instanceof Anthropic.AuthenticationError) return true;
    return false;
  }

  private getRetryDelay(error: unknown, attempt: number): number {
    // Check for Retry-After header hint
    if (error instanceof Anthropic.RateLimitError) {
      const retryAfter = error.headers?.["retry-after"];
      if (retryAfter) {
        const seconds = Number.parseFloat(retryAfter);
        if (!Number.isNaN(seconds)) return seconds * 1000;
      }
    }
    // Exponential backoff with jitter
    const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    const jitter = Math.random() * base * 0.5;
    return base + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── Error Types ──────────────────────────────────────────────────────────────

export type AgentModelErrorCode =
  | "CONTEXT_OVERFLOW"
  | "AUTH_ERROR"
  | "RATE_LIMIT"
  | "PROVIDER_ERROR";

export class AgentModelError extends Error {
  constructor(
    public readonly code: AgentModelErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "AgentModelError";
  }
}
