FROM node:22-slim AS base

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./

# Copy package manifests for dependency resolution
COPY packages/shared/package.json packages/shared/
COPY packages/supabase/package.json packages/supabase/
COPY gateway/package.json gateway/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/supabase/ packages/supabase/
COPY gateway/ gateway/

# Build
RUN pnpm --filter @karna/shared build && \
    pnpm --filter @karna/supabase build && \
    pnpm --filter @karna/gateway build

EXPOSE 18789

CMD ["node", "gateway/dist/index.js"]
