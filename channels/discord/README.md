# @karna/channel-discord

Discord channel adapter for Karna, built on discord.js.

## Setup

1. Create a Discord application at [discord.com/developers](https://discord.com/developers/applications)
2. Create a bot and copy the token
3. Configure environment variables:

| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token |
| `DISCORD_CLIENT_ID` | Application client ID |

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm build  # Compile TypeScript
```

## How It Works

The adapter connects to Discord via discord.js, listens for messages and slash commands, and forwards them to the Karna gateway over WebSocket. Agent responses are sent back to the originating Discord channel.
