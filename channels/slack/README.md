# @karna/channel-slack

Slack channel adapter for Karna, built on Slack Bolt.

## Setup

1. Create a Slack app at [api.slack.com](https://api.slack.com/apps)
2. Enable Socket Mode and add bot scopes
3. Configure environment variables:

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot user OAuth token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | App-level token (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | Request signing secret |

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm build  # Compile TypeScript
```

## How It Works

The adapter connects to Slack via Bolt and forwards messages to the Karna gateway over WebSocket. Responses from the agent are sent back to the originating Slack channel.
