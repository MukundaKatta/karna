// ─── OpenAI Model Provider ─────────────────────────────────────────────────

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionChunk,
} from "openai/resources/chat/completions.js";
import pino from "pino";
import type { ChatParams, ChatTool, ModelProvider, StreamEvent } from "./provider.js";
import { AgentModelError } from "./anthropic.js";

const logger = pino({ name: "openai-provider" });

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 4096;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * OpenAI provider implementing the ModelProvider interface.
 * Adapts OpenAI chat completions into the unified streaming format.
 */
export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey ?? process.env.OPENAI_API_KEY,
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
        const stream = await this.client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          messages,
          temperature: params.temperature ?? undefined,
          stop: params.stopSequences ?? undefined,
          tools: tools && tools.length > 0 ? tools : undefined,
          stream: true,
          stream_options: { include_usage: true },
        });

        yield* this.processStream(stream);
        return;
      } catch (error: unknown) {
        attempt++;

        if (this.isRateLimitError(error) && attempt < MAX_RETRIES) {
          const delay = this.getRetryDelay(attempt);
          logger.warn({ attempt, delay, model }, "Rate limited, retrying");
          await this.sleep(delay);
          continue;
        }

        if (this.isContextOverflowError(error)) {
          throw new AgentModelError(
            "CONTEXT_OVERFLOW",
            "Message exceeds model context window.",
            error
          );
        }

        if (this.isAuthError(error)) {
          throw new AgentModelError(
            "AUTH_ERROR",
            "Invalid or missing OpenAI API key.",
            error
          );
        }

        logger.error({ error, attempt, model }, "OpenAI API call failed");
        throw new AgentModelError(
          "PROVIDER_ERROR",
          `OpenAI API error after ${attempt} attempt(s): ${error instanceof Error ? error.message : String(error)}`,
          error
        );
      }
    }
  }

  countTokens(text: string): number {
    // Rough approximation. Use tiktoken for precision in production.
    return Math.ceil(text.length / 4);
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private buildMessages(params: ChatParams): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [];

    if (params.systemPrompt) {
      messages.push({ role: "system", content: params.systemPrompt });
    }

    for (const msg of params.messages) {
      if (msg.role === "system") {
        messages.push({ role: "system", content: msg.content });
        continue;
      }

      if (msg.role === "tool") {
        messages.push({
          role: "tool",
          content: msg.content,
          tool_call_id: msg.toolCallId ?? "",
        });
        continue;
      }

      if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content });
        continue;
      }

      // Assistant
      messages.push({ role: "assistant", content: msg.content });
    }

    return messages;
  }

  private buildTools(tools: ChatTool[]): ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object" as const,
          properties: tool.parameters.properties ?? {},
          required: tool.parameters.required ?? [],
        },
      },
    }));
  }

  private async *processStream(
    stream: AsyncIterable<ChatCompletionChunk>
  ): AsyncGenerator<StreamEvent> {
    // Accumulate tool call data across deltas
    const toolCalls = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];

      if (choice?.delta?.content) {
        yield { type: "text", text: choice.delta.content };
      }

      // Process tool call deltas
      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const existing = toolCalls.get(tc.index);
          if (!existing) {
            toolCalls.set(tc.index, {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              arguments: tc.function?.arguments ?? "",
            });
          } else {
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          }
        }
      }

      // Check for finish
      if (choice?.finish_reason === "tool_calls" || choice?.finish_reason === "stop") {
        // Emit accumulated tool calls
        for (const [, tc] of toolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.arguments) as Record<string, unknown>;
          } catch {
            logger.warn({ toolName: tc.name }, "Failed to parse tool call arguments");
          }
          yield { type: "tool_use", id: tc.id, name: tc.name, input };
        }
        toolCalls.clear();
      }

      // Emit usage if present
      if (chunk.usage) {
        yield {
          type: "usage",
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      }
    }

    yield { type: "done" };
  }

  private isRateLimitError(error: unknown): boolean {
    if (error instanceof OpenAI.RateLimitError) return true;
    return false;
  }

  private isContextOverflowError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes("maximum context length") ||
        msg.includes("context_length_exceeded")
      );
    }
    return false;
  }

  private isAuthError(error: unknown): boolean {
    if (error instanceof OpenAI.AuthenticationError) return true;
    return false;
  }

  private getRetryDelay(attempt: number): number {
    const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
    const jitter = Math.random() * base * 0.5;
    return base + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
