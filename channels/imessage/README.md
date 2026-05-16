# @karna/channel-imessage

iMessage channel adapter for Karna.

## Requirements

- macOS host (iMessage is only available on Apple platforms)
- Messages app configured with an Apple ID
- Full Disk Access for the terminal/process that runs the adapter
- AppleScript automation permission for Messages

This adapter cannot run in Linux servers, Docker containers, or Kubernetes pods.
It reads the local macOS Messages database and sends replies through AppleScript,
both of which are only available on a signed-in macOS desktop session.

For shared deployment manifests, keep the iMessage channel disabled. If a generic
launcher starts every channel, set `KARNA_SKIP_UNSUPPORTED_CHANNELS=1` so the
iMessage process exits successfully instead of failing the deployment on
non-macOS hosts.

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm build  # Compile TypeScript
```

## How It Works

The adapter bridges the macOS Messages framework to the Karna gateway over WebSocket. Incoming iMessages are forwarded to the agent, and responses are sent back through iMessage.

## Note

This adapter requires macOS and access to the local Messages database. It is intended for self-hosted personal use.
