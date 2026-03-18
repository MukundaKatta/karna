# @karna/channel-imessage

iMessage channel adapter for Karna.

## Requirements

- macOS host (iMessage is only available on Apple platforms)
- Messages app configured with an Apple ID

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm build  # Compile TypeScript
```

## How It Works

The adapter bridges the macOS Messages framework to the Karna gateway over WebSocket. Incoming iMessages are forwarded to the agent, and responses are sent back through iMessage.

## Note

This adapter requires macOS and access to the local Messages database. It is intended for self-hosted personal use.
