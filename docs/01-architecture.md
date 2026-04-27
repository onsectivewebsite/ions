# 01 — Architecture

## High-level diagram

```
                                  ┌─────────────────────────────────┐
                                  │          End Users              │
                                  │  Onsective | Firm Staff | Client│
                                  └────────────┬────────────────────┘
                                               │ HTTPS
                                               ▼
                              ┌────────────────────────────────────┐
                              │          Cloudflare                │
                              │  - DNS, WAF, Bot Mgmt, Turnstile   │
                              │  - R2 (object storage)             │
                              │  - Tunnel → VPS (no public ingress)│
                              └────────────┬───────────────────────┘
                                           │ Cloudflare Tunnel
                                           ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │                  Hostinger VPS (Docker host)                     │
        │ ┌────────────┐  ┌────────────┐  ┌────────────┐ ┌──────────────┐ │
        │ │ web (Next) │  │ api (tRPC+ │  │ worker     │ │ scheduler    │ │
        │ │  :3000     │  │  REST):4000│  │ (BullMQ)   │ │ (cron)       │ │
        │ └─────┬──────┘  └─────┬──────┘  └─────┬──────┘ └──────┬───────┘ │
        │       │               │               │               │         │
        │       └─────┬─────────┴───────┬───────┴───────┬───────┘         │
        │             ▼                 ▼               ▼                  │
        │      ┌────────────┐    ┌────────────┐  ┌────────────┐           │
        │      │ Postgres16 │    │  Redis 7   │  │  MinIO*    │           │
        │      │  primary   │    │  (queues+  │  │ (local dev │           │
        │      │  + replica │    │   cache)   │  │  S3 mock)  │           │
        │      └────────────┘    └────────────┘  └────────────┘           │
        └──────────────────────────────────────────────────────────────────┘
                                           │
            External services (egress)     │
            ┌──────────────────────────────┴───────────────────────────┐
            ▼                ▼                ▼               ▼         ▼
       ┌────────┐      ┌────────┐       ┌────────┐      ┌──────┐  ┌────────┐
       │ Stripe │      │ Twilio │       │ Resend │      │ Meta │  │Anthropic│
       │ Billing│      │ Voice  │       │ Email  │      │TikTok│  │ Claude  │
       └────────┘      └────────┘       └────────┘      └──────┘  └────────┘

        * MinIO local-dev only; production uses Cloudflare R2.
```

## Stack (confirmed defaults — change before Phase 0 if needed)

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript everywhere | One language across web/api/mobile, types end-to-end |
| Web framework | Next.js 15 (App Router) | SSR for client portal SEO, RSC for fast dashboards |
| API style | tRPC for internal, REST (OpenAPI) for public lead webhooks | Internal: type-safe; External: stable, documented |
| ORM | Prisma | Schema-first, migrations, supports Postgres RLS |
| DB | PostgreSQL 16 | Row-level security for tenant isolation, JSONB |
| Cache + Queue | Redis 7 + BullMQ | Lead distribution, alerts, retries with backoff |
| Object storage | Cloudflare R2 (S3 API) | No egress fees; lives next to Cloudflare we already use |
| Auth | Auth.js + WebAuthn (passkeys) + `otpauth` (TOTP) + email OTP | All three login modes you specified |
| Email | Resend (default) or SES | Transactional + templated |
| SMS/Voice | Twilio (per-firm subaccount) | Recording, programmable voice |
| Payments | Stripe Billing (SaaS seats) + Stripe Connect (firm→client invoices) | Single integration covers both |
| AI | Anthropic Claude Sonnet 4.6 / Opus 4.7 | Form-filling, doc extraction, agents |
| Mobile | Expo (React Native) + tvOS target | Shares tRPC client with web |
| Containerization | Docker Compose (single-host) → Kubernetes later | VPS-friendly, simple to operate |
| CI/CD | GitHub Actions | Build, test, image push, SSH deploy |
| Observability | OpenTelemetry → Grafana Cloud (free tier) or self-hosted Prometheus + Loki | Logs/metrics/traces unified |

## Monorepo layout

```
onsecboad/
├── apps/
│   ├── web/            # Next.js — staff dashboards + client portal
│   ├── api/            # standalone API host (worker shares this image)
│   ├── mobile/         # Expo app (Phase 9)
│   └── tv/             # tvOS lobby app (Phase 9)
├── packages/
│   ├── db/             # Prisma schema, migrations, seed
│   ├── auth/           # Auth.js config, passkey, TOTP, OTP helpers
│   ├── ui/             # shadcn-based component library + theme tokens
│   ├── api-client/     # tRPC client + REST SDK
│   ├── jobs/           # BullMQ job definitions
│   ├── integrations/   # twilio, stripe, meta, tiktok, resend wrappers
│   ├── ai/             # Anthropic client + prompts + form-fill pipelines
│   ├── pdf/            # invoice + retainer PDF rendering
│   ├── esign/          # in-house signature flow + audit trail
│   ├── tenancy/        # row-level tenant guard, context propagation
│   └── config/         # env schema (zod), feature flags, theme presets
├── infra/
│   ├── docker/         # Dockerfile per app, compose.yml, nginx if needed
│   ├── cloudflare/     # tunnel config, worker scripts (if any)
│   └── github-actions/ # CI workflows
├── docs/               # this directory — keep in repo
├── .env.example
├── package.json        # workspaces
├── pnpm-workspace.yaml
└── turbo.json          # build orchestration
```

## Multi-tenancy strategy

**Choice: Shared DB, Shared Schema, Row-level security (RLS) on every table with `tenant_id`.**

Reasons over schema-per-tenant or DB-per-tenant:
- Onsective scales to thousands of firms; schema-per-tenant breaks Postgres at ~500 tenants.
- RLS pushes the safety check into the database, not the app — defense in depth.
- Backups, migrations, and analytics stay simple.

### Implementation

1. Every table that holds tenant data has `tenant_id UUID NOT NULL` with a composite index `(tenant_id, ...)`.
2. RLS policy on each table:
   ```sql
   CREATE POLICY tenant_isolation ON cases
     USING (tenant_id = current_setting('app.tenant_id')::uuid);
   ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
   ```
3. The `packages/tenancy` middleware sets `app.tenant_id` on every DB connection from request context (derived from auth session).
4. Onsective platform-manager role uses a special "god mode" GUC that bypasses RLS — guarded by an explicit boolean check, audited on every use.

### Sub-tenant scoping (branch)

Branch managers see only their branch. Implemented in **app layer**, not RLS, because branch boundaries are softer (admins routinely cross). tRPC middleware reads the user's role + branch and applies a `branch_id` filter when needed.

## Auth flow

### Login modes

```
                    ┌─────────────────┐
                    │   /sign-in      │
                    └────────┬────────┘
                             │
            ┌────────────────┴────────────────┐
            │                                 │
            ▼                                 ▼
     [Email + Password]                 [Use Passkey]
            │                                 │
            ▼                                 ▼
   verify hash (argon2id)            WebAuthn ceremony
            │                                 │
            └────────────────┬────────────────┘
                             ▼
                  ┌──────────────────────┐
                  │   2FA required?      │
                  │ (yes for all roles)  │
                  └─────────┬────────────┘
                            │
              ┌─────────────┴────────────┐
              ▼                          ▼
      [TOTP (MS Auth)]             [Email OTP]
              │                          │
              └─────────────┬────────────┘
                            ▼
                ┌────────────────────────┐
                │ Issue session JWT +    │
                │ httpOnly refresh cookie│
                │ Set tenant context     │
                └────────────────────────┘
                            │
                            ▼
                  Redirect to dashboard
                  (role-based landing)
```

**No public signup.** Account creation is admin-driven only.

### Session model
- Access token: short-lived (15 min) JWT in memory.
- Refresh token: 30-day rolling, httpOnly + Secure + SameSite=Strict cookie.
- Device list visible in user settings; revoke per device.

### Passkey enrollment
- After first password login, prompt to enroll a passkey (skippable, surfaced again on next login).
- Up to 5 passkeys per user.

## API patterns

### tRPC (internal)

- Router per domain: `auth`, `tenant`, `user`, `lead`, `case`, `document`, `billing`, etc.
- Middleware chain: `traceMiddleware → authMiddleware → tenantMiddleware → rbacMiddleware → handler`.
- Errors thrown as `TRPCError` with codes mapped to HTTP semantically.
- Input validation via zod schemas colocated with procedures.

### REST (external)

- Versioned: `/api/v1/...`
- Lead ingestion: `POST /api/v1/leads/ingest` (per-firm API key in `Authorization: Bearer ...`)
- Webhooks (inbound): `/api/v1/webhooks/{stripe|twilio|meta|tiktok}` — signature verification mandatory.
- OpenAPI spec auto-generated from zod via `trpc-to-openapi` for the procedures we expose externally.

## Background jobs (BullMQ)

| Queue | Job | Trigger | Retry policy |
|---|---|---|---|
| `lead-distribute` | round-robin assign new lead to a telecaller | on lead created | 5x exponential |
| `email-send` | transactional email via Resend | on event | 3x backoff |
| `sms-send` | Twilio SMS | on event | 3x backoff |
| `recording-fetch` | pull Twilio recording → R2 | call ended webhook | 5x |
| `document-purge` | delete prior version on re-upload | post-upload | 3x |
| `deadline-check` | scan upcoming filing deadlines, send alerts | cron `0 */6 * * *` | 3x |
| `invoice-generate` | monthly per-seat usage roll-up | cron `0 2 1 * *` | 3x |
| `ai-form-fill` | run Claude form-fill pipeline | on demand | 2x, then dead-letter |
| `meta-lead-poll` | fallback poll if webhook missed | cron `*/15 * * * *` | 3x |

## Observability

- **Logs**: structured JSON via `pino`; collected by Promtail → Loki.
- **Metrics**: OpenTelemetry SDK; exposed at `/metrics`; scraped by Prometheus.
- **Traces**: OTel exporter → Tempo or Grafana Cloud.
- **Error tracking**: Sentry (self-hosted optional).
- **Uptime**: external check via UptimeRobot or Cloudflare Health Checks.

Key SLIs to instrument from day one:
- Page TTFB p95 < 400ms
- API p95 < 250ms
- Login success rate > 99%
- Background job success rate > 99.5%
- Twilio call connect rate > 95%

## Deployment topology

- **Domains**:
  - `app.onsecboad.com` — staff dashboards
  - `portal.onsecboad.com` — client portal
  - `api.onsecboad.com` — public REST
  - `*.lf.onsecboad.com` — optional per-firm subdomain (theming + CSP cookie)
- Cloudflare Tunnel from VPS — no inbound ports open on Hostinger.
- Docker Compose stack on VPS:
  - `web`, `api`, `worker`, `scheduler`, `postgres-primary`, `postgres-replica`, `redis`
- Backups:
  - `pg_basebackup` nightly → encrypted tarball → R2 (separate bucket, 30-day retention)
  - WAL archiving for PITR
- Zero-downtime deploys: build new image → `docker compose up -d` rolls the service (single replica is fine until usage demands more; then move to k3s).

## Speed / performance defaults

- All pages **MUST** ship under 200KB JS over the wire (gzip) for the first paint.
- Use RSC for dashboards; client components only for interactive widgets.
- Tailwind purge always on; never ship unused styles.
- DB: every query in a hot path **MUST** have an explain plan reviewed; missing indexes are a bug.
- Connection pooling: PgBouncer in front of Postgres in transaction mode.
- Cache layer: Redis read-through for tenant config, theme, role/permission lookups.

## Resume protocol for this doc

If you forgot the architecture: re-read sections "High-level diagram", "Multi-tenancy strategy", and "Auth flow". The rest is reference material.
