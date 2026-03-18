# @karna/channel-webchat

Embeddable web chat adapter for Karna, providing a browser-based chat UI.

## Setup

Configure environment variables:

| Variable | Description |
|---|---|
| `WEBCHAT_PORT` | Port for the Express server (default: 3001) |
| `GATEWAY_URL` | WebSocket URL of the Karna gateway |

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm build  # Compile TypeScript
```

## How It Works

The adapter runs an Express server that serves a web-based chat interface. Messages from the browser are forwarded to the Karna gateway over WebSocket, and agent responses are streamed back to the client in real time.
