# 05 — Code & Workflow Conventions

## Languages & versions

- Node 20 LTS; pnpm 9
- TypeScript strict mode (`"strict": true`, `"noUncheckedIndexedAccess": true`)
- React 19 / Next.js 15
- Postgres 16 / Prisma 5

## Naming

| Thing | Style | Example |
|---|---|---|
| File | kebab-case | `case-card.tsx` |
| Component | PascalCase | `CaseCard` |
| Hook | camelCase, prefix `use` | `useCurrentTenant` |
| tRPC router | camelCase | `caseRouter` |
| tRPC procedure | verbObject | `case.create`, `case.listForBranch` |
| REST route | kebab plural | `/api/v1/leads` |
| DB table | PascalCase singular (Prisma model) | `Case`, `DocumentRequest` |
| Env var | SCREAMING_SNAKE | `STRIPE_WEBHOOK_SECRET` |
| Feature flag | dot-namespace | `ai.formfill.enabled` |

## Folder layout in apps

```
apps/web/src/
├── app/
│   ├── (auth)/sign-in/page.tsx
│   ├── (platform)/...           # Onsective platform routes
│   ├── (firm)/...               # firm staff dashboards
│   ├── (portal)/...             # client portal (separate auth)
│   ├── api/                     # route handlers (REST, webhooks)
│   └── layout.tsx
├── components/                  # app-specific composites; primitives live in packages/ui
├── server/
│   ├── trpc/                    # routers
│   ├── auth/
│   ├── db.ts                    # Prisma client singleton
│   └── context.ts               # request context
└── lib/                         # client-side utilities
```

## Git workflow

- `main` = production
- `dev` = integration; auto-deployed to staging on push
- Feature branches: `phase-N/short-slug` e.g., `phase-3/twilio-softphone`
- PRs require: passing CI, 1 approval, conventional commit title, linked phase + acceptance item
- Squash-merge to `dev`; `dev` merges to `main` per release

### Conventional commits

`feat(phase-3): add round-robin lead assignment job`
`fix(case): prevent submit when balance > 0`
`chore(deps): bump prisma to 5.x`
`docs(phase-6): clarify document re-upload rule`

## Tests

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | pure functions, reducers, utilities |
| Component | Vitest + Testing Library | components in isolation |
| Integration | Vitest + testcontainers (real Postgres + Redis) | tRPC procedures end-to-end |
| E2E | Playwright | critical flows (login, create lead, schedule appt, sign retainer) |
| Visual | Playwright snapshots | per-theme rendering of key screens |
| Load | k6 | once per phase before deploy |

Coverage target: **80% lines on `packages/*` and `apps/api`**, no target on UI but all critical components must have at least one test.

## CI pipeline

```
on: pull_request, push to main/dev
jobs:
  - lint        : eslint + prettier --check
  - typecheck   : tsc --noEmit
  - test        : pnpm -r test (unit + integration)
  - e2e         : playwright (only on PR to main)
  - build       : turbo build
  - db-check    : prisma migrate diff --exit-code
  - audit       : pnpm audit --prod (fail on high+)
  - build-image : docker build, push to GHCR (only main/dev)
  - deploy      : ssh to VPS, pull, compose up (only main → prod, dev → staging)
```

## Code review checklist (paste into PR template)

- [ ] Touches tenant data → has integration test that proves cross-tenant isolation
- [ ] New endpoint → rate limit set
- [ ] New table → has `tenant_id`, RLS enabled, indexes added
- [ ] Stores PII → consent captured upstream / encrypted at rest if Tier-1
- [ ] Has user-visible string → translated (en + fr)
- [ ] Has dropdown → direction + width follows `03-design-system.md`
- [ ] Mutates state → emits AuditLog
- [ ] Background job → idempotent, has retry + dead-letter
- [ ] Public endpoint → input validated with zod
- [ ] Phase doc updated if behavior changed
