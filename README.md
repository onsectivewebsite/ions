# OnsecBoad

AI-powered immigration office management & CRM SaaS for Canadian immigration law firms. Built and sold by **Onsective Inc.**

> Full design and roadmap lives in [`docs/`](docs/). Start with [`docs/00-INDEX.md`](docs/00-INDEX.md).

## Phase status

| # | Phase | Status |
|---|-------|--------|
| 0 | Foundation (auth + tenancy + theming) | **scaffolded — needs `pnpm install` + DB + first run** |
| 1+ | Tenant lifecycle, billing, CRM, cases, AI, mobile, hardening | not started |

Phase 0 covers a deployable empty product: multi-tenant Postgres, password + 2FA auth (TOTP and email OTP), six-theme branding, role-based dashboards. Detail per phase in `docs/phase-*.md`.

## Stack (locked in Phase 0)

- TypeScript everywhere
- Next.js 15 (App Router) — `apps/web`
- tRPC + Express — `apps/api`
- PostgreSQL 16 + Prisma — `packages/db`
- Redis 7 — auth tickets, queues (Phase 1+)
- Argon2id passwords + WebAuthn passkeys + TOTP + email OTP — `packages/auth`
- shadcn-style primitives + CSS variable themes — `packages/ui`
- Docker Compose for local infra — `infra/docker`

## Repo layout

```
apps/
  api/        # tRPC + REST (Express)
  web/        # Next.js — staff dashboards + (later) client portal
packages/
  auth/       # password, TOTP, OTP, passkey, JWT, RBAC
  config/     # zod env schema + theme presets
  db/         # Prisma schema, client, seed
  email/      # SMTP transport + branded templates (OTP, invite, reset)
  tenancy/    # tenant context propagation (RLS-ready)
  ui/         # primitives + theme provider
infra/
  docker/     # compose + Dockerfiles
  postgres/   # init.sql with extensions
docs/         # architecture, data model, design system, per-phase plans
.github/      # CI workflow
```

## First-time setup

Prereqs: **Node 20+**, **pnpm 9** (auto-installed via corepack), **Docker** (for Postgres + Redis).

```bash
./scripts/setup.sh   # idempotent — safe to re-run
pnpm dev             # turbo runs api (:4000) + web (:3000) in parallel
```

The setup script: installs deps, starts Postgres (`:5433`) + Redis (`:6379`), creates `.env` from the example if missing (and only if missing — never clobbers), auto-fills dev JWT/encryption secrets, runs Prisma generate + migrate + seed, and links `packages/db/.env → ../../.env` so `prisma` works from any cwd.

To run the steps manually instead, see `scripts/setup.sh`.

Visit http://localhost:3000/sign-in.

### Seeded credentials

| Role | Email | Password |
|------|-------|----------|
| Onsective superadmin | `onsectivesoftware@outlook.com` | `OnsecBoad!ChangeMe123` |
| Demo Firm Admin | `admin@acme.test` | `Admin!ChangeMe123` |

> Change both immediately after first login. The seed script is idempotent.

> 2FA: email-OTP is delivered via SMTP (Hostinger by default — configure `SMTP_*` in `.env`). Set `EMAIL_DRY_RUN=true` to log messages instead of sending. TOTP works after you enroll via `auth.totpBeginEnroll`/`auth.totpConfirmEnroll`.
>
> If you sign in as the seeded `admin@acme.test` (a non-existent address), the OTP cannot arrive in any inbox — change `SEED_SUPERADMIN_EMAIL` / the demo email in `packages/db/prisma/seed.ts` to an address you control, or sign in as the superadmin (defaults to `onsectivesoftware@outlook.com`).

## Common scripts

| Command | What |
|---|---|
| `pnpm dev` | Run web + api with hot reload |
| `pnpm build` | Build everything |
| `pnpm typecheck` | tsc across workspace |
| `pnpm lint` | eslint across workspace |
| `pnpm test` | run tests (where defined) |
| `pnpm db:generate` | regenerate Prisma client |
| `pnpm db:migrate` | apply migrations (production) |
| `pnpm db:migrate:dev -- --name <name>` | create + apply a new dev migration (interactive) |
| `pnpm db:studio` | open Prisma Studio |
| `pnpm db:seed` | (re-)seed superadmin + demo tenant |

## Resume protocol

If you sat down with no memory of where you left off:

1. Open `docs/00-INDEX.md` — the **Phase status tracker** tells you the current phase.
2. Open the matching `docs/phase-NN-*.md`.
3. Scroll to the bottom — **Resume checkpoint** lists files that should exist after that phase.
4. `git log --oneline | head -20` — see last commits.
5. `pnpm typecheck && pnpm test` — confirm baseline is green.
6. Continue from the first unchecked acceptance criterion.

## Deployment (Phase 0 close-out / Phase 1)

Production runs as Docker Compose on Hostinger VPS, fronted by Cloudflare (DNS + WAF + Tunnel — no inbound ports on the VPS). Object storage on Cloudflare R2.

Production compose, Cloudflare tunnel config, and CI deploy steps land alongside the Phase 1 billing work — see `docs/phase-01-tenant-billing.md`.

## License

Proprietary — © Onsective Inc.
