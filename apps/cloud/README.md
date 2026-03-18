# @karna/cloud

Cloud SaaS API backend for Karna, providing managed agent hosting, billing, and multi-tenant access.

## Features

- JWT-based authentication
- Agent CRUD and management
- Subscription and billing (Stripe / Razorpay)
- Usage tracking and analytics
- API key generation and management
- Rate limiting and CORS

## Setup

```bash
pnpm install
pnpm build
```

## Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `JWT_SECRET` | Secret for signing JWTs |
| `STRIPE_SECRET_KEY` | Stripe API key (optional) |

## Usage

```bash
pnpm dev    # Start with hot reload
pnpm start  # Production mode
```

## Tech Stack

- **Fastify** — HTTP server
- **Supabase** — Database and auth
- **@karna/payments** — Payment processing
