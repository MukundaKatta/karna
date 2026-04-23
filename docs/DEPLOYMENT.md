# Deployment

Karna is easiest to run publicly with:

- the gateway on a container host such as Render
- the web app on Vercel

That keeps the websocket-heavy backend on infrastructure that likes long-lived Node processes, while the Next.js dashboard stays on the platform it already targets.

## Recommended production path

### 1. Deploy the gateway

This repo includes [render.yaml](../render.yaml) for a Render web service named `karna-gateway`.

The Blueprint defaults to Render's `free` web service so you can bring up a public endpoint without an immediate billing step. If you want steadier websocket behavior and no spin-downs, upgrade the service to `starter` or above after the first deploy.

It is preconfigured for the Google AI Studio / Gemini OpenAI-compatible endpoint:

- `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`
- `KARNA_DEFAULT_PROVIDER=openai`
- `KARNA_DEFAULT_MODEL=gemini-3-flash-preview`

During service creation, provide:

- `OPENAI_API_KEY`
  Use a Google AI Studio key.
- `GATEWAY_CORS_ORIGINS`
  Keep `https://karna-web.vercel.app` or replace it with your own frontend domain.

Render generates `GATEWAY_AUTH_TOKEN` automatically from the Blueprint.

### 2. Point Vercel at the gateway

In the `karna-web` Vercel project, set these production environment variables to the public gateway URL:

- `GATEWAY_URL=https://your-gateway-host`
- `NEXT_PUBLIC_GATEWAY_URL=https://your-gateway-host`
- `NEXT_PUBLIC_WS_URL=wss://your-gateway-host/ws`

Then redeploy the web app.

### 3. Verify the deployment

Gateway checks:

```bash
curl https://your-gateway-host/health
curl https://your-gateway-host/api/runtime
```

Web checks:

```bash
curl https://your-web-host/api/gateway
```

Then open the chat UI and verify:

- the gateway status is connected
- sessions appear in the sidebar
- one real model reply completes end to end

## Environment notes

The gateway now supports both platform-standard and Karna-specific env names:

- port: `GATEWAY_PORT` or `PORT`
- CORS: `GATEWAY_CORS_ORIGINS` or `CORS_ORIGINS`

That makes Docker, Render, and similar hosts behave consistently without extra glue.
