import { describe, it, expect, vi } from 'vitest';
import {
  McpClientCore,
  McpRpcError,
  type McpTransport,
} from '../../gateway/src/mcp/client-core';
import type { JsonRpcRequest, JsonRpcResponse } from '../../gateway/src/mcp/server';

/**
 * In-memory mock transport: routes requests by method to handlers and supports
 * pushing server notifications. No real network/process/SDK involved.
 */
class MockTransport implements McpTransport {
  readonly sent: JsonRpcRequest[] = [];
  private notifHandler?: (n: JsonRpcRequest) => void;
  closed = false;

  constructor(
    private readonly handlers: Record<string, (params: unknown) => unknown> = {},
  ) {}

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    this.sent.push(request);
    // Notification (no id) — fire and forget.
    if (request.id === undefined || request.id === null) return undefined;
    const handler = this.handlers[request.method];
    if (!handler) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `method not found: ${request.method}` },
      };
    }
    try {
      return { jsonrpc: '2.0', id: request.id, result: handler(request.params) };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32603, message: (err as Error).message },
      };
    }
  }

  onNotification(handler: (n: JsonRpcRequest) => void): void {
    this.notifHandler = handler;
  }

  pushNotification(method: string, params?: unknown): void {
    this.notifHandler?.({ jsonrpc: '2.0', method, params });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('McpClientCore (#543, #546)', () => {
  it('performs initialize handshake and emits initialized notification', async () => {
    const transport = new MockTransport({
      initialize: () => ({
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'srv', version: '9.9.9' },
      }),
    });
    const client = new McpClientCore(transport);
    const res = await client.initialize();
    expect(res.serverInfo).toEqual({ name: 'srv', version: '9.9.9' });
    expect(client.isInitialized).toBe(true);
    expect(client.getServerInfo()).toEqual({ name: 'srv', version: '9.9.9' });
    expect(client.getServerCapabilities()).toEqual({ tools: { listChanged: true } });
    // initialize (id=1) then notifications/initialized (no id)
    expect(transport.sent.map((s) => s.method)).toEqual([
      'initialize',
      'notifications/initialized',
    ]);
    expect(transport.sent[1].id).toBeUndefined();
  });

  it('lists tools', async () => {
    const transport = new MockTransport({
      'tools/list': () => ({
        tools: [{ name: 'a', description: 'A', inputSchema: { type: 'object' } }],
      }),
    });
    const client = new McpClientCore(transport);
    const tools = await client.listTools();
    expect(tools).toEqual([
      { name: 'a', description: 'A', inputSchema: { type: 'object' } },
    ]);
  });

  it('calls a tool and normalises the result', async () => {
    const transport = new MockTransport({
      'tools/call': (params) => {
        expect(params).toEqual({ name: 'echo', arguments: { x: 1 } });
        return { content: [{ type: 'text', text: 'hi' }] };
      },
    });
    const client = new McpClientCore(transport);
    const result = await client.callTool('echo', { x: 1 });
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }], isError: false });
  });

  it('surfaces JSON-RPC errors as McpRpcError', async () => {
    const transport = new MockTransport({
      'tools/call': () => {
        throw new Error('boom');
      },
    });
    const client = new McpClientCore(transport);
    await expect(client.callTool('x')).rejects.toBeInstanceOf(McpRpcError);
  });

  it('throws when no response is received for a request', async () => {
    const transport: McpTransport = { send: async () => undefined };
    const client = new McpClientCore(transport);
    await expect(client.listTools()).rejects.toBeInstanceOf(McpRpcError);
  });

  it('fetches a resource into a context attachment (text + binary flag)', async () => {
    const transport = new MockTransport({
      'resources/list': () => ({
        resources: [{ uri: 'mem://a', name: 'A', mimeType: 'text/plain' }],
      }),
      'resources/read': (params) => {
        expect(params).toEqual({ uri: 'mem://a' });
        return {
          contents: [
            { uri: 'mem://a', mimeType: 'text/plain', text: 'line1' },
            { uri: 'mem://a', text: 'line2' },
            { uri: 'mem://a', blob: 'AAAA' },
          ],
        };
      },
    });
    const client = new McpClientCore(transport);
    const resources = await client.listResources();
    expect(resources).toHaveLength(1);
    const att = await client.fetchResourceAttachment('mem://a');
    expect(att).toEqual({
      uri: 'mem://a',
      mimeType: 'text/plain',
      text: 'line1\nline2',
      hasBinary: true,
    });
  });

  it('resolves a prompt template into messages', async () => {
    const transport = new MockTransport({
      'prompts/list': () => ({
        prompts: [{ name: 'greet', arguments: [{ name: 'who', required: true }] }],
      }),
      'prompts/get': (params) => {
        expect(params).toEqual({ name: 'greet', arguments: { who: 'world' } });
        return {
          description: 'greeting',
          messages: [{ role: 'user', content: { type: 'text', text: 'hi world' } }],
        };
      },
    });
    const client = new McpClientCore(transport);
    const prompts = await client.listPrompts();
    expect(prompts[0].name).toBe('greet');
    const resolved = await client.getPrompt('greet', { who: 'world' });
    expect(resolved.description).toBe('greeting');
    expect(resolved.messages[0].content.text).toBe('hi world');
  });

  it('dispatches tools/list_changed notifications to subscribers', async () => {
    const transport = new MockTransport();
    const client = new McpClientCore(transport);
    const handler = vi.fn();
    const unsub = client.onToolsListChanged(handler);
    transport.pushNotification('notifications/tools/list_changed');
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    transport.pushNotification('notifications/tools/list_changed');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('closes the underlying transport', async () => {
    const transport = new MockTransport();
    const client = new McpClientCore(transport);
    await client.close();
    expect(transport.closed).toBe(true);
    expect(client.isInitialized).toBe(false);
  });
});
