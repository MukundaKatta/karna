// ─── Agent Runtime ─────────────────────────────────────────────────────────
//
// The core agent execution loop: context -> LLM -> tools -> reply.
// Orchestrates context building, model routing, tool execution,
// and memory persistence for each conversation turn.
//
// ───────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type { ConversationMessage, Session } from "@karna/shared/types/session.js";
import type { SkillMetadata } from "@karna/shared/types/skill.js";
import type { MemoryEntry } from "@karna/shared/types/memory.js";
import { buildContext, type ContextBuilderConfig } from "./context/builder.js";
import { searchRelevantMemories } from "./context/memory-search.js";
import type { AgentPersona } from "./context/system-prompt.js";
import type { ChatMessage, ModelProvider, StreamEvent } from "./models/provider.js";
import { routeModel, type AgentConfig } from "./models/router.js";
import { ToolRegistry, type ToolDefinitionRuntime, type ToolPolicy, type ToolResult } from "./tools/registry.js";
import { executeTool } from "./tools/executor.js";
import { requiresApproval, requestApproval, type ApprovalCallback } from "./tools/approval.js";
import { MemoryStore, type SaveMemoryInput } from "./memory/store.js";
import type { Embedder } from "./memory/embedder.js";

const logger = pino({ name: "agent-runtime" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RuntimeConfig {
  /** Context builder configuration. */
  context?: Partial<ContextBuilderConfig>;
  /** Maximum number of tool-use iterations per turn. */
  maxToolIterations?: number;
  /** Maximum conversation history messages to load. */
  maxHistoryMessages?: number;
  /** Whether to extract and store memories automatically. */
  autoMemory?: boolean;
}

export interface AgentTurnInput {
  /** The user's message. */
  message: string;
  /** The current session. */
  session: Session;
  /** The agent persona/config. */
  agent: AgentPersona & AgentConfig;
  /** Conversation history (loaded externally). */
  conversationHistory: ConversationMessage[];
  /** Active skills for this session. */
  skills?: SkillMetadata[];
  /** Custom instructions for this turn. */
  customInstructions?: string;
}

export interface AgentTurnResult {
  /** The assistant's final text response. */
  response: string;
  /** All tool calls made during this turn. */
  toolCalls: ToolCallRecord[];
  /** Token usage for this turn. */
  usage: { inputTokens: number; outputTokens: number };
  /** Whether the turn completed successfully. */
  success: boolean;
  /** Error message if the turn failed. */
  error?: string;
  /** The model used for this turn. */
  model: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result: ToolResult;
  approved: boolean;
}

/**
 * Callback for streaming text deltas to the client.
 */
export type StreamCallback = (event: StreamEvent) => void;

/**
 * Callback to load conversation history for a session.
 */
export type HistoryLoader = (
  sessionId: string,
  limit: number
) => Promise<ConversationMessage[]>;

const DEFAULT_MAX_TOOL_ITERATIONS = 10;
const DEFAULT_MAX_HISTORY = 50;

// ─── Agent Runtime ──────────────────────────────────────────────────────────

/**
 * The AgentRuntime is the core orchestrator. It manages the agent loop:
 *
 * 1. Load session history
 * 2. Search semantic memory for relevant context
 * 3. Build system prompt with agent persona, memories, skills
 * 4. Route to the appropriate model
 * 5. Stream the LLM response
 * 6. Handle tool_use blocks (approval -> execute -> feed back)
 * 7. Extract and store new memories
 * 8. Return the final response
 */
export class AgentRuntime {
  private readonly toolRegistry: ToolRegistry;
  private readonly memoryStore: MemoryStore | null;
  private readonly embedder: Embedder | null;
  private readonly config: Required<RuntimeConfig>;
  private approvalCallback: ApprovalCallback | null = null;
  private streamCallback: StreamCallback | null = null;
  private running = false;
  private abortController: AbortController | null = null;

  constructor(
    toolRegistry: ToolRegistry,
    memoryStore?: MemoryStore,
    embedder?: Embedder,
    config?: RuntimeConfig
  ) {
    this.toolRegistry = toolRegistry;
    this.memoryStore = memoryStore ?? null;
    this.embedder = embedder ?? null;
    this.config = {
      context: config?.context ?? {},
      maxToolIterations: config?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS,
      maxHistoryMessages: config?.maxHistoryMessages ?? DEFAULT_MAX_HISTORY,
      autoMemory: config?.autoMemory ?? true,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize the runtime. Register built-in tools and warm up connections.
   */
  async init(): Promise<void> {
    logger.info("Initializing agent runtime");
    this.running = true;
    logger.info(
      { toolCount: this.toolRegistry.size },
      "Agent runtime initialized"
    );
  }

  /**
   * Stop the runtime gracefully. Abort any in-flight operations.
   */
  async stop(): Promise<void> {
    logger.info("Stopping agent runtime");
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    logger.info("Agent runtime stopped");
  }

  /**
   * Set the callback for tool approval requests.
   */
  setApprovalCallback(callback: ApprovalCallback): void {
    this.approvalCallback = callback;
  }

  /**
   * Set the callback for streaming response events.
   */
  setStreamCallback(callback: StreamCallback): void {
    this.streamCallback = callback;
  }

  // ─── Main Agent Loop ───────────────────────────────────────────────────

  /**
   * Execute a single agent turn: process the user's message and return a response.
   * This is the primary entry point for the agent loop.
   */
  async run(input: AgentTurnInput): Promise<AgentTurnResult> {
    if (!this.running) {
      throw new Error("Agent runtime is not running. Call init() first.");
    }

    this.abortController = new AbortController();

    const startTime = Date.now();
    const toolCalls: ToolCallRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    try {
      // 1. Search semantic memory for relevant context
      const memories = await this.searchMemories(input);

      // 2. Build context (system prompt + messages)
      const context = buildContext(
        {
          session: input.session,
          agent: input.agent,
          conversationHistory: input.conversationHistory,
          memories,
          skills: input.skills,
          customInstructions: input.customInstructions,
        },
        this.config.context
      );

      // 3. Route to the appropriate model
      const route = routeModel(input.message, input.agent);

      logger.info(
        {
          sessionId: input.session.id,
          agentId: input.agent.id,
          model: route.model,
          complexity: route.complexity,
          contextTokens: context.estimatedTokens,
          messageCount: context.messages.length,
        },
        "Starting agent turn"
      );

      // 4. Get available tools
      const toolPolicy = this.buildToolPolicy(input.agent, input.session);
      const chatTools = this.toolRegistry.getChatTools(toolPolicy);

      // 5. Enter the agent loop (LLM call -> tool use -> repeat)
      let messages: ChatMessage[] = [
        ...context.messages,
        { role: "user", content: input.message },
      ];
      let response = "";
      let iterations = 0;

      while (iterations < this.config.maxToolIterations) {
        iterations++;
        this.checkAborted();

        // Call the model
        const { text, toolUses, usage } = await this.callModel(
          route.provider,
          route.model,
          context.systemPrompt,
          messages,
          chatTools
        );

        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;

        // If no tool use, we have the final response
        if (toolUses.length === 0) {
          response = text;
          break;
        }

        // Process tool calls
        response = text; // Accumulate any text before tool calls
        const toolCallStart = toolCalls.length;
        const toolMessages = await this.processToolCalls(
          toolUses,
          input.session,
          input.agent,
          toolPolicy,
          toolCalls
        );
        const processedToolCalls = toolCalls.slice(toolCallStart);

        if (this.shouldStopAfterRejectedToolCalls(processedToolCalls)) {
          response = this.buildRejectedToolResponse(processedToolCalls, text);
          break;
        }

        // Add assistant message with tool use and tool results to conversation
        messages = [
          ...messages,
          { role: "assistant", content: text, toolUses },
          ...toolMessages,
        ];
      }

      if (iterations >= this.config.maxToolIterations) {
        logger.warn(
          { sessionId: input.session.id, iterations },
          "Max tool iterations reached"
        );
        if (!response) {
          response = "I've reached the maximum number of tool operations for this turn. Here's what I've accomplished so far.";
        }
      }

      // 6. Extract and store memories
      if (this.config.autoMemory && this.memoryStore) {
        await this.extractAndStoreMemories(input, response);
      }

      const durationMs = Date.now() - startTime;
      logger.info(
        {
          sessionId: input.session.id,
          model: route.model,
          toolCallCount: toolCalls.length,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs,
        },
        "Agent turn completed"
      );

      return {
        response,
        toolCalls,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        success: true,
        model: route.model,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: errorMessage, sessionId: input.session.id },
        "Agent turn failed"
      );

      return {
        response: "",
        toolCalls,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        success: false,
        error: errorMessage,
        model: "unknown",
      };
    } finally {
      this.abortController = null;
    }
  }

  // ─── Private: Model Call ──────────────────────────────────────────────

  private async callModel(
    provider: ModelProvider,
    model: string,
    systemPrompt: string,
    messages: ChatMessage[],
    tools: ReturnType<ToolRegistry["getChatTools"]>
  ): Promise<{
    text: string;
    toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
    usage: { inputTokens: number; outputTokens: number };
  }> {
    let text = "";
    const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let usage = { inputTokens: 0, outputTokens: 0 };

    const stream = provider.chat({
      messages,
      systemPrompt,
      model,
      tools: tools.length > 0 ? tools : undefined,
    });

    for await (const event of stream) {
      this.checkAborted();

      switch (event.type) {
        case "text":
          text += event.text;
          this.streamCallback?.(event);
          break;
        case "tool_use":
          toolUses.push({ id: event.id, name: event.name, input: event.input });
          this.streamCallback?.(event);
          break;
        case "usage":
          usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          this.streamCallback?.(event);
          break;
        case "done":
          this.streamCallback?.(event);
          break;
      }
    }

    return { text, toolUses, usage };
  }

  // ─── Private: Tool Processing ─────────────────────────────────────────

  private async processToolCalls(
    toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>,
    session: Session,
    agent: AgentPersona & AgentConfig,
    policy: ToolPolicy,
    records: ToolCallRecord[]
  ): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];

    for (const toolUse of toolUses) {
      this.checkAborted();

      const tool = this.toolRegistry.get(toolUse.name);
      if (!tool) {
        logger.warn({ toolName: toolUse.name }, "Tool not found");
        messages.push({
          role: "tool",
          content: JSON.stringify({ error: `Tool "${toolUse.name}" not found` }),
          toolCallId: toolUse.id,
          toolName: toolUse.name,
        });
        records.push({
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
          result: { output: null, isError: true, errorMessage: "Tool not found", durationMs: 0 },
          approved: false,
        });
        continue;
      }

      // Check approval
      let approved = true;
      if (requiresApproval(tool, policy)) {
        approved = await this.handleApproval(toolUse.id, tool, toolUse.input, session, agent);
      }

      if (!approved) {
        logger.info({ toolName: tool.name, toolCallId: toolUse.id }, "Tool call rejected");
        messages.push({
          role: "tool",
          content: JSON.stringify({ error: "Tool call was rejected by the user" }),
          toolCallId: toolUse.id,
          toolName: toolUse.name,
        });
        records.push({
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
          result: { output: null, isError: true, errorMessage: "Rejected by user", durationMs: 0 },
          approved: false,
        });
        continue;
      }

      // Execute tool
      const result = await executeTool(tool, toolUse.input, {
        sessionId: session.id,
        agentId: agent.id,
        userId: session.userId,
        workingDirectory: undefined,
      });

      messages.push({
        role: "tool",
        content: JSON.stringify(result.isError ? { error: result.errorMessage } : result.output),
        toolCallId: toolUse.id,
        toolName: toolUse.name,
      });

      records.push({
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
        result,
        approved: true,
      });
    }

    return messages;
  }

  private shouldStopAfterRejectedToolCalls(records: ToolCallRecord[]): boolean {
    return (
      records.length > 0 &&
      records.every(
        (record) =>
          !record.approved &&
          record.result.isError &&
          record.result.errorMessage === "Rejected by user",
      )
    );
  }

  private buildRejectedToolResponse(
    records: ToolCallRecord[],
    modelText: string,
  ): string {
    const toolNames = Array.from(new Set(records.map((record) => record.name)));
    const toolLabel =
      toolNames.length === 1
        ? `the ${toolNames[0]} tool`
        : `the requested tools (${toolNames.join(", ")})`;
    const denial =
      `I couldn't run ${toolLabel} because it was not approved. ` +
      "No action was taken. If you want me to try again, approve the tool request from a channel that supports approvals or ask for a non-tool alternative.";
    const prefix = modelText.trim();

    return prefix ? `${prefix}\n\n${denial}` : denial;
  }

  private async handleApproval(
    toolCallId: string,
    tool: ToolDefinitionRuntime,
    args: Record<string, unknown>,
    session: Session,
    agent: AgentPersona & AgentConfig
  ): Promise<boolean> {
    if (!this.approvalCallback) {
      logger.warn(
        { toolName: tool.name },
        "No approval callback set, auto-rejecting high-risk tool"
      );
      return false;
    }

    try {
      const response = await requestApproval(
        this.approvalCallback,
        toolCallId,
        tool,
        args,
        session.id,
        agent.id
      );
      return response.approved;
    } catch (error) {
      logger.error({ error, toolName: tool.name }, "Approval request failed");
      return false;
    }
  }

  // ─── Private: Memory ──────────────────────────────────────────────────

  private async searchMemories(input: AgentTurnInput): Promise<MemoryEntry[]> {
    if (!this.memoryStore) return [];

    try {
      return await searchRelevantMemories(
        this.memoryStore,
        input.agent.id,
        input.message,
        { limit: 10, minRelevance: 0.3 },
        this.embedder ?? undefined
      );
    } catch (error) {
      logger.error({ error, agentId: input.agent.id }, "Memory search failed");
      return [];
    }
  }

  private async extractAndStoreMemories(
    input: AgentTurnInput,
    response: string
  ): Promise<void> {
    if (!this.memoryStore) return;

    try {
      // Store the conversation turn as a memory
      const memoryContent = `User asked: ${input.message.slice(0, 200)}\nAssistant responded: ${response.slice(0, 200)}`;

      const memoryInput: SaveMemoryInput = {
        agentId: input.agent.id,
        content: memoryContent,
        source: "conversation",
        priority: "normal",
        sessionId: input.session.id,
        userId: input.session.userId,
        tags: ["conversation"],
      };

      // Generate embedding if embedder is available
      if (this.embedder) {
        try {
          const result = await this.embedder.embed(memoryContent);
          memoryInput.embedding = result.embedding;
        } catch (error) {
          logger.warn({ error }, "Failed to generate memory embedding");
        }
      }

      await this.memoryStore.save(memoryInput);
    } catch (error) {
      logger.warn({ error }, "Failed to store conversation memory");
    }
  }

  // ─── Private: Helpers ─────────────────────────────────────────────────

  private buildToolPolicy(agent: AgentConfig, session: Session): ToolPolicy {
    return {
      allowList: session.context?.tools ?? undefined,
      denyList: undefined,
      approvalOverrides: undefined,
    };
  }

  private checkAborted(): void {
    if (this.abortController?.signal.aborted) {
      throw new Error("Agent turn was aborted");
    }
  }
}
