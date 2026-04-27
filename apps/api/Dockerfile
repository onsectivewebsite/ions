# syntax=docker/dockerfile:1.7

# ─── deps ──────────────────────────────────────────────────────────────────
# Install workspace deps. Cached layer — only invalidates when any
# package.json or the lockfile changes.
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl python3 make g++
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/auth/package.json packages/auth/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/email/package.json packages/email/
COPY packages/tenancy/package.json packages/tenancy/
COPY packages/ui/package.json packages/ui/
COPY packages/integrations/stripe/package.json packages/integrations/stripe/
COPY packages/integrations/r2/package.json packages/integrations/r2/
COPY packages/integrations/twilio/package.json packages/integrations/twilio/
COPY packages/integrations/meta/package.json packages/integrations/meta/
COPY packages/integrations/tiktok/package.json packages/integrations/tiktok/
RUN pnpm install --frozen-lockfile

# ─── build ─────────────────────────────────────────────────────────────────
# Add source + generated Prisma client. Everything pnpm needs to resolve
# workspace imports — including the per-package `node_modules/` symlink
# trees — is now in place.
FROM deps AS build
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @onsecboad/db exec prisma generate

# ─── runtime ───────────────────────────────────────────────────────────────
# Reuse the build stage as-is; only change the entrypoint + drop privileges.
# Running via `pnpm --filter ... exec tsx` lets pnpm find tsx wherever it
# happens to live (root or workspace-member node_modules), which is the
# whole point — node's bare `--import tsx` couldn't.
FROM build AS runtime
RUN apk add --no-cache tini && \
    addgroup -g 1001 -S nodejs && adduser -S onsec -u 1001 -G nodejs && \
    chown -R onsec:nodejs /app
USER onsec
ENV NODE_ENV=production
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "@onsecboad/api", "exec", "tsx", "src/main.ts"]
