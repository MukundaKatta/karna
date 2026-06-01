/**
 * Adapter: agent `ToolRegistry` → MCP `ToolProvider` (Issue #544).
 *
 * The {@link McpServer} consumes a minimal {@link ToolProvider} (`list()` /
 * `get()` returning {@link ExposableTool}s). The agent's `ToolRegistry` exposes
 * a richer runtime shape whose `execute` takes a `ToolExecutionContext`. This
 * adapter bridges the two without importing the agent at runtime — it only
 * relies on the structural shape, keeping the gateway/agent boundary clean.
 *
 * Note: the MCP server still filters everything through its allowlist + the
 * `available` flag, so this adapter exposing a tool does NOT mean it is
 * reachable unless an operator allowlists it.
 */
import type { ExposableTool, ToolProvider } from "./server.js";

/** Execution context the agent's tool handlers expect. */
export interface ToolExecutionContextLike {
  sessionId: string;
  agentId: string;
  userId?: string;
  workingDirectory?: string;
  signal?: AbortSignal;
}

/** Minimal runtime-tool shape (structurally satisfied by `ToolDefinitionRuntime`). */
export interface RuntimeToolLike {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  execute: (input: Record<string, unknown>, context: ToolExecutionContextLike) => Promise<unknown>;
}

/** Minimal registry surface used by the adapter (satisfied by `ToolRegistry`). */
export interface RegistryLike {
  getTools(): RuntimeToolLike[];
  get(name: string): RuntimeToolLike | undefined;
}

/**
 * Build a {@link ToolProvider} backed by a `ToolRegistry`. Every MCP `tools/call`
 * runs the underlying tool with a context produced by `contextFactory` (so each
 * call can carry a fresh abort signal / synthetic session identity).
 */
export function createRegistryToolProvider(
  registry: RegistryLike,
  contextFactory: () => ToolExecutionContextLike,
): ToolProvider {
  const toExposable = (tool: RuntimeToolLike): ExposableTool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as Record<string, unknown>,
    execute: (input: unknown) =>
      tool.execute((input ?? {}) as Record<string, unknown>, contextFactory()),
    available: true,
  });

  return {
    list: () => registry.getTools().map(toExposable),
    get: (name: string) => {
      const tool = registry.get(name);
      return tool ? toExposable(tool) : undefined;
    },
  };
}
