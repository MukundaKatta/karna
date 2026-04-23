// ─── Model Provider Interface ──────────────────────────────────────────────

/**
 * Events emitted during streaming LLM responses.
 */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done" };

/**
 * A tool call emitted by the assistant and later answered by a tool message.
 */
export interface ChatToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * A message in the conversation passed to the model.
 */
export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolUses?: ChatToolUse[];
}

/**
 * Tool definition formatted for LLM consumption.
 */
export interface ChatTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Parameters for a chat completion request.
 */
export interface ChatParams {
  messages: ChatMessage[];
  systemPrompt?: string;
  tools?: ChatTool[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

/**
 * Unified interface for LLM providers (Anthropic, OpenAI, etc.).
 * Each provider adapts the vendor SDK into a common streaming interface.
 */
export interface ModelProvider {
  /** Human-readable provider name (e.g. "anthropic", "openai"). */
  readonly name: string;

  /**
   * Stream a chat completion. Yields events as the model generates a response.
   * The caller is responsible for iterating the generator to completion.
   */
  chat(params: ChatParams): AsyncGenerator<StreamEvent>;

  /**
   * Estimate token count for a piece of text.
   * Returns undefined if the provider does not support token counting.
   */
  countTokens?(text: string): number;
}
