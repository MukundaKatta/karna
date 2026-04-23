# Deployment

Karna is easiest to run publicly with:

- the gateway on a container host such as Render
- the web app on Vercel or on the same Render Blueprint

That keeps the websocket-heavy backend on infrastructure that likes long-lived Node processes, while the Next.js dashboard stays on the platform it already targets.

## Recommended production path

### 1. Deploy the gateway and web shell
This repo includes [render.yaml](../render.yaml) for:

- `karna-gateway`
- `karna-web`

The Blueprint defaults to Render's `free` web service so you can bring up a public endpoint without an immediate billing step. If you want steadier websocket behavior and no spin-downs, upgrade the service to `starter` or above after the first deploy.

It is preconfigured for the Google AI Studio / Gemini OpenAI-compatible endpoint:

- `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`
- `KARNA_DEFAULT_PROVIDER=openai`
- `KARNA_DEFAULT_MODEL=gemini-3-flash-preview`

During service creation, provide:

- `OPENAI_API_KEY`
  Use a Google AI Studio key.
- `GATEWAY_CORS_ORIGINS`
  Replace the default with your actual public frontend domain once you know it.
- `KARNA_BETA_ACCESS_CODE`
  Recommended for invite-only beta deployments so public users must enter a code before reaching the live app.

Render generates `GATEWAY_AUTH_TOKEN` automatically from the Blueprint.

For the `karna-web` service in the same Blueprint, Render automatically wires:

- `GATEWAY_URL` to the private `karna-gateway` host/port

You still need to set these public browser env vars after the gateway has a public URL:

- `NEXT_PUBLIC_GATEWAY_URL=https://your-gateway-host`
- `NEXT_PUBLIC_WS_URL=wss://your-gateway-host/ws`
- `KARNA_WEB_SESSION_SECRET=your-random-secret`
  Optional but recommended if you enable `KARNA_BETA_ACCESS_CODE`.

### 2. Optional: point Vercel at the gateway instead

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
curl https://your-web-host/api/health
curl https://your-web-host/api/gateway
```

Then open the chat UI and verify:

- the sign-in flow behaves the way you expect for public beta access
- the gateway status is connected
- sessions appear in the sidebar
- one real model reply completes end to end

Public trust pages you can link immediately:

- `/status`
- `/support`
- `/privacy`
- `/terms`

## Environment notes

The gateway now supports both platform-standard and Karna-specific env names:

- port: `GATEWAY_PORT` or `PORT`
- CORS: `GATEWAY_CORS_ORIGINS` or `CORS_ORIGINS`

The web app now behaves safely in production too:

- server proxy: `GATEWAY_URL` or `NEXT_PUBLIC_GATEWAY_URL`
- browser REST client: `NEXT_PUBLIC_GATEWAY_URL`
- browser websocket: `NEXT_PUBLIC_WS_URL`, or it derives from `NEXT_PUBLIC_GATEWAY_URL`

That makes Docker, Render, and similar hosts behave consistently without extra glue.
