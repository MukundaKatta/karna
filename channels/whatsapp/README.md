# @karna/channel-whatsapp

WhatsApp channel adapter for Karna, built on Baileys.

## Setup

1. A WhatsApp account is required for the bridge
2. Configure environment variables:

| Variable | Description |
|---|---|
| `WHATSAPP_AUTH_DIR` | Directory for storing auth credentials |

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm build  # Compile TypeScript
```

## How It Works

The adapter uses Baileys (WhatsApp Web protocol) to connect to WhatsApp and forwards messages to the Karna gateway over WebSocket. Agent responses are sent back to the originating WhatsApp conversation.

## Note

This adapter uses the unofficial WhatsApp Web protocol via Baileys. Use in compliance with WhatsApp's terms of service.
