# @karna/channel-telegram

Telegram channel adapter for Karna, built on grammY.

## Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Configure environment variables:

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather |

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm build  # Compile TypeScript
```

## How It Works

The adapter connects to Telegram via grammY, listens for messages and commands, and forwards them to the Karna gateway over WebSocket. Agent responses are sent back to the originating Telegram chat.
