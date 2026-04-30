# syntax=docker/dockerfile:1.7

# ─── deps ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
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
COPY packages/integrations/ai/package.json packages/integrations/ai/
RUN pnpm install --frozen-lockfile

# ─── builder ───────────────────────────────────────────────────────────────
FROM deps AS builder
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages ./packages
COPY apps/web ./apps/web
# Prisma client is referenced by @onsecboad/db, which @onsecboad/web transpiles.
RUN pnpm --filter @onsecboad/db exec prisma generate

# Build-time env: NEXT_PUBLIC_* vars are baked into the client bundle here.
# Override at build time with --build-arg.
ARG NEXT_PUBLIC_API_URL=https://api.onsective.cloud
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @onsecboad/web build

# ─── runtime ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4001

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# Next standalone output ships its own minimal node_modules + server.js
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 4001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
