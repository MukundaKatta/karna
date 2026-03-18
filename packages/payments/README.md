# @karna/payments

Payment processing and subscription management for Karna Cloud.

## Features

- Multi-provider support (Stripe, Razorpay)
- Subscription plan management
- Usage-based billing
- Provider abstraction layer

## Usage

```typescript
import { createPaymentProvider } from '@karna/payments';

const provider = createPaymentProvider('stripe', {
  secretKey: process.env.STRIPE_SECRET_KEY,
});

// Create a subscription
await provider.createSubscription(customerId, planId);

// Track usage
await provider.recordUsage(subscriptionId, quantity);
```

## Supported Providers

| Provider | Status |
|---|---|
| Stripe | Supported |
| Razorpay | Supported |

## Development

```bash
pnpm build      # Compile TypeScript
pnpm typecheck   # Type checking only
```
