import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { McpServer } from "../../gateway/src/mcp/server.js";
import { registerMcpRoutes } from "../../gateway/src/routes/mcp.js";
import {
  createRegistryToolProvider,
  type RegistryLike,
  type RuntimeToolLike,
} from "../../gateway/src/mcp/tool-provider.js";

// A minimal registry standing in for the agent's ToolRegistry.
function makeRegistry(tools: RuntimeToolLike[]): RegistryLike {
  const map = new Map(tools.map((t) => [t.name, t]));
  return { getTools: () => [...map.values()], get: (n) => map.get(n) };
}

const echoTool: RuntimeToolLike = {
  name: "echo",
  description: "echoes input back",
  parameters: { type: "object", properties: { text: { type: "string" } } },
  execute: async (input) => ({ echoed: input }),
};

describe("MCP HTTP route (#544)", () => {
  let app: ReturnType<typeof Fastify>;

  async function build(allowlist: string[], enabled = true) {
    app = Fastify();
    let lastCtxAgentId = "";
    const provider = createRegistryToolProvider(makeRegistry([echoTool]), () => {
      lastCtxAgentId = "mcp-server";
      return { sessionId: "mcp-test", agentId: lastCtxAgentId };
    });
    const mcp = new McpServer(provider, { enabled, allowlist });
    registerMcpRoutes(app, mcp);
    await app.ready();
    return app;
  }

  it("liveness GET reports enabled state", async () => {
    await build(["echo"]);
    const res = await app.inject({ method: "GET", url: "/mcp" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ server: "karna-gateway", enabled: true });
  });

  it("tools/list returns only allowlisted tools", async () => {
    await build(["echo"]);
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(res.statusCode).toBe(200);
    const names = res.json().result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(["echo"]);
  });

  it("tools/call executes the underlying tool with a synthetic context", async () => {
    await build(["echo"]);
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hi" } },
      },
    });
    expect(res.statusCode).toBe(200);
    // Result is wrapped as MCP content; the echoed payload should be present.
    expect(JSON.stringify(res.json().result)).toContain("hi");
  });

  it("does not expose tools that are not allowlisted", async () => {
    await build([]); // enabled but empty allowlist => nothing exposed
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 3, method: "tools/list" },
    });
    expect(res.json().result.tools).toEqual([]);
  });

  it("returns a JSON-RPC parse error for malformed bodies", async () => {
    await build(["echo"]);
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "content-type": "text/plain" },
      payload: "}{ not json",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().error.code).toBe(-32700);
  });
});

describe("createRegistryToolProvider adapter (#544)", () => {
  it("maps runtime tools to ExposableTools and runs execute with context", async () => {
    let seenContext: unknown;
    const tool: RuntimeToolLike = {
      name: "probe",
      description: "d",
      parameters: { type: "object", properties: {} },
      execute: async (input, ctx) => {
        seenContext = ctx;
        return { input };
      },
    };
    const provider = createRegistryToolProvider(makeRegistry([tool]), () => ({
      sessionId: "s1",
      agentId: "a1",
    }));
    const exposed = provider.list();
    expect(exposed).toHaveLength(1);
    expect(exposed[0]).toMatchObject({ name: "probe", available: true });
    expect(exposed[0].inputSchema).toEqual({ type: "object", properties: {} });

    await exposed[0].execute({ x: 1 });
    expect(seenContext).toEqual({ sessionId: "s1", agentId: "a1" });

    expect(provider.get("probe")?.name).toBe("probe");
    expect(provider.get("missing")).toBeUndefined();
  });
});
