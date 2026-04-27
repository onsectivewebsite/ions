#!/usr/bin/env bash
# OnsecBoad first-time setup. Idempotent — safe to re-run.
# Usage:   ./scripts/setup.sh
# Run from anywhere; this script always operates against the repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

# 1. Tooling sanity
step "Checking toolchain"
command -v node >/dev/null || { echo "node not found — install Node 20+ (nvm/mise/asdf/system)"; exit 1; }
NODE_MAJOR=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node 20+ required (have $(node -v))"; exit 1; }
ok "node $(node -v)"
corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@9.12.0 --activate >/dev/null 2>&1 || true
ok "pnpm $(pnpm -v)"

# 2. Install deps
step "Installing dependencies"
pnpm install

# 3. Local infra
step "Starting Postgres + Redis"
docker compose -f infra/docker/compose.yml up -d
ok "containers up (postgres :5433, redis :6379)"

# 4. .env + dev secrets — same idempotent helper that runs on every `pnpm dev`.
step "Ensuring .env and dev secrets"
bash scripts/ensure-secrets.sh

# 5. Database
step "Generating Prisma client"
pnpm db:generate

step "Applying migrations"
# Wait for postgres to accept connections before migrate runs.
for i in 1 2 3 4 5 6 7 8 9 10; do
  docker exec onsec-postgres pg_isready -U onsec -d onsecboad >/dev/null 2>&1 && break
  sleep 1
done

if [ ! -d packages/db/prisma/migrations ] || [ -z "$(ls -A packages/db/prisma/migrations 2>/dev/null)" ]; then
  # Fresh repo — generate the init migration. `migrate dev` needs a TTY,
  # so use diff+deploy which works headless and produces the same result.
  MIG_DIR="packages/db/prisma/migrations/$(date -u +%Y%m%d%H%M%S)_init"
  mkdir -p "$MIG_DIR"
  ( set -a; . ./.env; set +a
    pnpm --filter @onsecboad/db exec prisma migrate diff \
      --from-empty \
      --to-schema-datamodel prisma/schema.prisma \
      --script > "$MIG_DIR/migration.sql"
    pnpm --filter @onsecboad/db exec prisma migrate deploy
  )
  ok "init migration created and applied"
else
  ( set -a; . ./.env; set +a
    pnpm --filter @onsecboad/db exec prisma migrate deploy
  )
  ok "migrations up to date"
fi

step "Seeding database"
pnpm db:seed

step "Setup complete"
cat <<EOF

  Next:  pnpm dev          # web :3000  +  api :4000

  The seed step above prints initial passwords ONLY for users it just created.
  On re-runs of this script, existing users keep whatever password they have.

  For new schema changes later:  pnpm db:migrate:dev -- --name <name>
EOF
