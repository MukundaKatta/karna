import { describe, it, expect, vi } from 'vitest';
import {
  McpServer,
  JsonRpcErrorCodes,
  type ToolProvider,
  type ExposableTool,
} from '../../gateway/src/mcp/server';

function makeTool(over: Partial<ExposableTool> = {}): ExposableTool {
  return {
    name: 'echo',
    description: 'echoes input',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    execute: async (input) => input,
    ...over,
  };
}

function makeProvider(tools: ExposableTool[]): ToolProvider {
  const map = new Map(tools.map((t) => [t.name, t]));
  return {
    list: () => [...map.values()],
    get: (name) => map.get(name),
  };
}

describe('gateway McpServer (#544)', () => {
  it('is disabled by default and exposes nothing', async () => {
    const server = new McpServer(makeProvider([makeTool()]));
    expect(server.enabled).toBe(false);
    expect(server.exposedTools()).toEqual([]);
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(res?.error?.code).toBe(JsonRpcErrorCodes.InvalidRequest);
  });

  it('only exposes allowlisted tools when enabled', () => {
    const server = new McpServer(
      makeProvider([makeTool({ name: 'echo' }), makeTool({ name: 'danger' })]),
      { enabled: true, allowlist: ['echo'] },
    );
    const names = server.exposedTools().map((t) => t.name);
    expect(names).toEqual(['echo']);
  });

  it('hides unavailable tools', () => {
    const server = new McpServer(
      makeProvider([makeTool({ name: 'echo', available: false })]),
      { enabled: true, allowlist: ['echo'] },
    );
    expect(server.exposedTools()).toEqual([]);
  });

  it('responds to initialize handshake', async () => {
    const server = new McpServer(makeProvider([]), { enabled: true });
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {},
    });
    expect(res?.result).toMatchObject({
      protocolVersion: expect.any(String),
      serverInfo: { name: 'karna-gateway' },
    });
  });

  it('lists allowlisted tools via tools/list', async () => {
    const server = new McpServer(
      makeProvider([makeTool({ name: 'echo' })]),
      { enabled: true, allowlist: ['echo'] },
    );
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect((res?.result as { tools: unknown[] }).tools).toHaveLength(1);
  });

  it('calls a tool and wraps the result in content blocks', async () => {
    const execute = vi.fn(async (input: unknown) => ({ got: input }));
    const server = new McpServer(
      makeProvider([makeTool({ name: 'echo', execute })]),
      { enabled: true, allowlist: ['echo'] },
    );
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'hi' } },
    });
    expect(execute).toHaveBeenCalledWith({ text: 'hi' });
    expect(res?.result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({ got: { text: 'hi' } }) }],
    });
  });

  it('rejects calling a non-allowlisted tool', async () => {
    const server = new McpServer(
      makeProvider([makeTool({ name: 'secret' })]),
      { enabled: true, allowlist: [] },
    );
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'secret', arguments: {} },
    });
    expect(res?.error?.code).toBe(JsonRpcErrorCodes.InvalidParams);
  });

  it('returns isError when the tool throws', async () => {
    const server = new McpServer(
      makeProvider([
        makeTool({
          name: 'boom',
          execute: async () => {
            throw new Error('kaboom');
          },
        }),
      ]),
      { enabled: true, allowlist: ['boom'] },
    );
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'boom', arguments: {} },
    });
    expect(res?.result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'kaboom' }],
    });
  });

  it('returns MethodNotFound for unknown methods', async () => {
    const server = new McpServer(makeProvider([]), { enabled: true });
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      id: 5,
      method: 'does/not/exist',
    });
    expect(res?.error?.code).toBe(JsonRpcErrorCodes.MethodNotFound);
  });

  it('treats requests without id as notifications (no response)', async () => {
    const server = new McpServer(makeProvider([]), { enabled: true });
    const res = await server.handleRequest({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(res).toBeUndefined();
  });

  it('handles raw JSON strings and parse errors', async () => {
    const server = new McpServer(makeProvider([]), { enabled: true });
    const ok = await server.handleRaw(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    );
    expect(JSON.parse(ok!)).toMatchObject({ id: 1, result: {} });

    const bad = await server.handleRaw('{not json');
    expect(JSON.parse(bad!).error.code).toBe(JsonRpcErrorCodes.ParseError);
  });

  it('handles JSON-RPC batches', async () => {
    const server = new McpServer(
      makeProvider([makeTool({ name: 'echo' })]),
      { enabled: true, allowlist: ['echo'] },
    );
    const raw = await server.handleRaw(
      JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ]),
    );
    const parsed = JSON.parse(raw!) as unknown[];
    // notification produces no response
    expect(parsed).toHaveLength(2);
  });
});
