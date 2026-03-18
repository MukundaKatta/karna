# @karna/gateway

WebSocket gateway that manages multi-client connections, session state, and message routing between channels and the agent.

## Architecture

The gateway is the central hub connecting channels to the agent runtime:

```
Channels (Slack, Discord, ...) → WebSocket → Gateway → Agent
```

## Key Modules

| Module | Description |
|---|---|
| `src/index.ts` | Fastify server with WebSocket support |
| `src/protocol/` | Message protocol and authentication |
| `src/session/` | Session management and state compaction |
| `src/mcp/` | Model Context Protocol integration |
| `src/heartbeat/` | Periodic task scheduling |
| `src/health/` | Health checks and metrics |
| `src/webhooks/` | GitHub and Stripe webhook handlers |

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm start  # Production mode
```

## Dependencies

- **Fastify** — HTTP and WebSocket server
- **@fastify/websocket** — WebSocket support
- **@modelcontextprotocol/sdk** — MCP integration
