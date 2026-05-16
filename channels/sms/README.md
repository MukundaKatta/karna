# @karna/channel-sms

SMS channel adapter for Karna, built on Twilio.

## Setup

1. Create a Twilio account at [twilio.com](https://www.twilio.com)
2. Get a phone number with SMS capabilities
3. Configure environment variables:

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Your Twilio phone number |

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm build  # Compile TypeScript
```

## How It Works

The adapter runs an Express server that receives incoming SMS via Twilio webhooks and forwards messages to the Karna gateway over WebSocket. Agent responses are sent back via the Twilio API.

Outbound responses are constrained to Twilio's practical concatenated SMS limit
of 1600 characters, or roughly 10 standard 160-character segments. Longer agent
responses are truncated with a continuation notice instead of sending many SMS
bodies unexpectedly. Segment estimates are logged for cost monitoring.
