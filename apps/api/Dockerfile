# syntax=docker/dockerfile:1.7

# ─── deps stage ────────────────────────────────────────────────────────────
# Cache the pnpm install in its own layer; all source changes downstream
# don't invalidate node_modules.
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
RUN pnpm install --frozen-lockfile

# ─── prisma stage ──────────────────────────────────────────────────────────
# Generate the Prisma client. Schema is the only thing that determines the
# generated code; copying just it keeps this layer cacheable.
FROM deps AS prisma
COPY packages/db/prisma packages/db/prisma
RUN pnpm --filter @onsecboad/db exec prisma generate

# ─── runtime ───────────────────────────────────────────────────────────────
# Run with tsx so workspace path imports (@onsecboad/*) resolve without us
# having to compile each package. tsx caches its transpile so the runtime
# overhead is negligible for a long-lived server.
FROM node:20-alpine AS runtime
RUN apk add --no-cache libc6-compat openssl tini
WORKDIR /app
ENV NODE_ENV=production

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S onsec -u 1001 -G nodejs

# Bring in node_modules with the generated Prisma client
COPY --from=prisma /app/node_modules ./node_modules
COPY --from=prisma /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=prisma /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=prisma /app/package.json ./package.json
COPY --from=prisma /app/packages/db/node_modules ./packages/db/node_modules

# App source
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/api ./apps/api
COPY packages ./packages

USER onsec
EXPOSE 4000

# tini gives us proper signal forwarding so SIGTERM from `docker stop`
# triggers a clean shutdown instead of a kill -9.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
