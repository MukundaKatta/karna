// ─── Local Model Provider (Issue #595) ───────────────────────────────────────
//
// Implements the streaming `ModelProvider` interface against any
// OpenAI-compatible local endpoint (Ollama, LM Studio, vLLM, llama.cpp's
// server, etc). Uses `fetch` only — no new dependencies and no provider SDK —
// so it is fully testable with an injected fetch. Not auto-registered anywhere;
// construct and add it to the router/failover chain explicitly to enable it.
//
// Errors are surfaced by throwing `AgentModelError` (consistent with the other
// providers), so the failover chain treats a bad local endpoint like any other
// provider failure.

import pino from "pino";
import type { ModelProvider, ChatParams, ChatTool, StreamEvent, ChatMessage } from "./provider.js";
import { AgentModelError } from "./anthropic.js";

const logger = pino({ name: "local-provider" });

export interface LocalProviderConfig {
  /** Base URL of the OpenAI-compatible endpoint, e.g. "http://localhost:11434/v1". */
  baseUrl: string;
  /** Optional bearer token (most local servers don't need one). */
  apiKey?: string;
  /** Model used when a request doesn't specify one. */
  defaultModel?: string;
  /** Advertised model list (informational). */
  models?: string[];
  /** Provider name; defaults to "local". */
  name?: string;
  /** Injected fetch (defaults to global fetch); primarily for tests. */
  fetchImpl?: typeof fetch;
}

interface OpenAIToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

export class LocalProvider implements ModelProvider {
  public readonly name: string;
  public readonly models: string[];
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LocalProviderConfig) {
    if (!config.baseUrl) {
      throw new Error("LocalProvider requires a baseUrl");
    }
    this.name = config.name ?? "local";
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel;
    this.models = config.models ?? (config.defaultModel ? [config.defaultModel] : []);
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamEvent> {
    const model = params.model || this.defaultModel;
    if (!model) {
      throw new AgentModelError("PROVIDER_ERROR", "No model specified and no defaultModel configured");
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;

    const body = {
      model,
      messages: this.toRequestMessages(params),
      tools: params.tools?.map((t: ChatTool) => this.toRequestTool(t)),
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stop: params.stopSequences,
      stream: false,
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AgentModelError(
        "PROVIDER_ERROR",
        `Local model request failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AgentModelError("PROVIDER_ERROR", `Local model HTTP ${res.status}: ${text}`);
    }

    const data = (await res.json()) as OpenAIChatResponse;
    if (data.error) {
      const msg = typeof data.error === "string" ? data.error : data.error.message;
      throw new AgentModelError("PROVIDER_ERROR", msg ?? "unknown local model error");
    }

    const message = data.choices?.[0]?.message;
    if (message?.content) {
      yield { type: "text", text: message.content };
    }
    for (const tc of message?.tool_calls ?? []) {
      yield {
        type: "tool_use",
        id: tc.id ?? `call_${Date.now()}`,
        name: tc.function?.name ?? "",
        input: parseArgs(tc.function?.arguments),
      };
    }

    yield {
      type: "usage",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
    yield { type: "done" };
  }

  countTokens(text: string): number {
    // Rough approximation; good enough for budgeting against local models.
    return Math.ceil(text.length / 4);
  }

  /** Whether the endpoint is reachable (best-effort health check via /models). */
  async healthCheck(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;
      const res = await this.fetchImpl(`${this.baseUrl}/models`, { headers });
      return res.ok;
    } catch {
      return false;
    }
  }

  private toRequestMessages(params: ChatParams): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    if (params.systemPrompt) {
      out.push({ role: "system", content: params.systemPrompt });
    }
    for (const m of params.messages as ChatMessage[]) {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.toolCallId) msg.tool_call_id = m.toolCallId;
      if (m.toolName) msg.name = m.toolName;
      if (m.toolUses && m.toolUses.length > 0) {
        msg.tool_calls = m.toolUses.map((tu) => ({
          id: tu.id,
          type: "function",
          function: { name: tu.name, arguments: JSON.stringify(tu.input) },
        }));
      }
      out.push(msg);
    }
    return out;
  }

  private toRequestTool(tool: ChatTool): Record<string, unknown> {
    return {
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    };
  }
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

logger.debug("Local provider module loaded");
