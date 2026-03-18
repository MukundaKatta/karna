# @karna/supabase

Supabase client wrapper and database utilities for Karna.

## Features

- Pre-configured Supabase client
- Pre-built queries for common operations
- Database migration support
- Seed data utilities

## Usage

```typescript
import { createClient } from '@karna/supabase';

const supabase = createClient({
  url: process.env.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_KEY,
});
```

## Environment Variables

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |

## Development

```bash
pnpm build      # Compile TypeScript
pnpm typecheck   # Type checking only
```
