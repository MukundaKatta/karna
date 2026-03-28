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
COPY config/ config/

# Build
RUN pnpm --filter @karna/shared build && \
    pnpm --filter @karna/supabase build && \
    pnpm --filter @karna/gateway build

# ─── Production stage ────────────────────────────────────────────────────

FROM node:22-slim AS production

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Create non-root user
RUN groupadd --gid 1000 karna && \
    useradd --uid 1000 --gid karna --shell /bin/sh --create-home karna

WORKDIR /app

# Copy built artifacts from base
COPY --from=base --chown=karna:karna /app/node_modules ./node_modules
COPY --from=base --chown=karna:karna /app/packages/shared/dist ./packages/shared/dist
COPY --from=base --chown=karna:karna /app/packages/shared/package.json ./packages/shared/
COPY --from=base --chown=karna:karna /app/packages/supabase/dist ./packages/supabase/dist
COPY --from=base --chown=karna:karna /app/packages/supabase/package.json ./packages/supabase/
COPY --from=base --chown=karna:karna /app/gateway/dist ./gateway/dist
COPY --from=base --chown=karna:karna /app/gateway/package.json ./gateway/
COPY --from=base --chown=karna:karna /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=base --chown=karna:karna /app/config ./config

# Switch to non-root user
USER karna

ENV NODE_ENV=production

EXPOSE 18789

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const h=require('http');h.get('http://localhost:18789/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "gateway/dist/index.js"]
