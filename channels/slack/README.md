# @karna/channel-slack

Slack channel adapter for Karna, built on Slack Bolt.

## Setup

1. Open [api.slack.com/apps](https://api.slack.com/apps) and choose **Create New App**.
2. Select **From an app manifest**.
3. Choose your workspace and paste `channels/slack/manifest.yaml`.
4. Replace the placeholder slash command and interactivity URLs if you run Slack over HTTP instead of Socket Mode.
5. Install the app to your workspace.
6. Create an app-level token with `connections:write` for Socket Mode.
7. Configure environment variables:

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot user OAuth token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | App-level token (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | Request signing secret |

The manifest configures the required bot scopes, Socket Mode, event subscriptions for `message.im`, `app_mention`, and `message.channels`, plus the `/ask`, `/remember`, and `/skills` slash commands.

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm build  # Compile TypeScript
```

## How It Works

The adapter connects to Slack via Bolt and forwards messages to the Karna gateway over WebSocket. Responses from the agent are sent back to the originating Slack channel.
