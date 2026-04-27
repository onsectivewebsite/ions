# Phase 0 Checkpoint — what is scaffolded, what to do next

This file is the "where are we" marker after the Phase 0 build pass. Everything in
"Scaffolded" is on disk, typechecks clean, and (where applicable) has tests.

## ✓ Scaffolded

- Monorepo (`pnpm-workspace.yaml`, `turbo.json`, root `package.json`, `tsconfig.base.json`, **`pnpm-lock.yaml` committed**)
- `packages/config` — zod env schema (SMTP-aware), six theme presets + `buildCustomTheme`, `themeToCssVars`, **6 Vitest tests**
- `packages/db` — Prisma schema for Phase 0 tables (PlatformUser, Tenant, Branch, User, Role, Passkey, Session, Invite, AuditLog), seed script, **RLS migration** (`20260427000000_rls`) with `app_tenant_match()` helper enabling row-level security on Tenant/Branch/User/Role/Invite/AuditLog
- `packages/auth` — argon2id passwords, TOTP, email OTP, AES-GCM encrypted-column helpers, WebAuthn ceremony helpers (registration + authentication), JWT + refresh-token helpers, RBAC scope resolver, **34 Vitest tests** covering each module
- `packages/tenancy` — `withTenant` and `withPlatformGod` transaction wrappers (sets `app.tenant_id` / `app.is_platform` GUCs that the RLS migration reads)
- `packages/email` — nodemailer SMTP transport (Hostinger-ready), `sendOtpEmail` / `sendInviteEmail` / `sendPasswordResetEmail`, branded HTML+text templates with per-tenant theming, `EMAIL_DRY_RUN` mode for offline dev. Wired into `auth.requestEmailOtp` — real OTPs ship to the user's inbox via SMTP.
- `packages/ui` — `ThemeProvider` (CSS-variable injection), primitives: Button/Input/Card/Label/Badge/**Skeleton/Spinner/Avatar**, ThemeSwatchGrid
- `apps/api` — Express + tRPC server; routers: `auth` (signIn → ticket → 2FA → session, lockout after 5 failures, TOTP enroll/confirm, signOut, **passkey begin/finish authentication + registration**), `user.me` / `user.updateProfile` / **`user.passkeyList` / `user.passkeyDelete`**, `tenant.brandingGet/Update` (with audit), `platform.tenantList/auditList`
- `apps/web` — Next.js 15 with **Inter + JetBrains Mono via `next/font`**, premium UI:
  - `/` — landing with gradient headline, feature trio
  - `/sign-in` — two-column hero with abstract SVG mesh, password + **passkey button** (working WebAuthn ceremony), polished inputs with leading icons
  - `/sign-in/2fa` — separate-digit OTP input with paste handling, method tabs (Authenticator vs Email)
  - `/dashboard` — full app shell (sidebar + top bar with search + bell + user dropdown), gradient hero banner, `StatCard` grid, `EmptyDashboard` SVG
  - `/settings/branding` — controls + **live mini-dashboard preview** that re-renders inline as you switch themes
  - `/settings/passkeys` — manage passkeys (add via WebAuthn, delete, see device + last-used)
- `infra/docker` — Postgres 16 (port 5433) + Redis compose, init.sql with `pgcrypto`/`citext`/`pg_trgm`, Dockerfiles for web + api
- `scripts/setup.sh` — idempotent first-time setup (deps, infra, secrets, migrations, seed)
- `.github/workflows/ci.yml` — install + db generate + typecheck + lint + test + drift check + build
- `README.md` with setup, scripts, resume protocol

**Verification (run from repo root):**
```
pnpm typecheck   # → 8/8 packages green
pnpm test        # → 40/40 tests pass (34 auth + 6 config; api uses --passWithNoTests)
```

## ✗ Not yet implemented in Phase 0 (intentional — left for Phase 1)

- Logo upload to R2 (UI accepts a URL; storage wrapper lands with Phase 6 documents work)
- Refresh-token rotation flow (refresh tokens are issued + stored hashed; rotation endpoint lands when the access token expires in real workflows)
- Production Docker compose with Cloudflare Tunnel sidecar (Phase 0 ships dev compose; prod compose lands in Phase 1)
- App-layer enforcement of `withTenant` / `withPlatformGod` (the wrappers exist; auth/tenant routers will be threaded through them in Phase 1 alongside the first multi-tenant data tables — see RLS caveat below)

### RLS caveat (read this before relying on RLS in dev)

PostgreSQL bypasses RLS for the **table owner** and superusers. The compose file
runs Postgres as `onsec` who owns the schema, so RLS policies are a no-op
locally. The migration uses `FORCE ROW LEVEL SECURITY` which still doesn't
cover superusers. Production must connect the application as a separate
non-superuser role distinct from the Prisma migration user — that role split
lands in Phase 1 alongside the production compose. The policies themselves are
correct and ready to go.

## First-run smoke test

Reproduce these in order — if all pass, Phase 0 is verified:

1. `./scripts/setup.sh` succeeds (idempotent, safe to re-run)
2. `pnpm typecheck && pnpm test` are green
3. `pnpm dev` brings web on `:3000`, api on `:4000`
4. `curl http://localhost:4000/api/health` → `{"ok":true}`
5. Visit `http://localhost:3000/` — premium landing page renders
6. Click "Sign in" → two-column hero + form
7. Sign in as `onsectivesoftware@outlook.com / OnsecBoad!ChangeMe123` → 2FA → "Email code" → check the `donotreply@onsective.com` inbox SENT folder for the outbound OTP, or check the Outlook inbox for arrival
   - Alternatively, set `EMAIL_DRY_RUN=true` in `.env` to log OTPs to the API console instead of sending
8. Land on dashboard with sidebar + topbar + gradient hero + stat cards
9. Open `/settings/branding` → click each swatch → live preview re-renders inline → save → reload → selection persists
10. Open `/settings/passkeys` → "Add a passkey" → browser prompts for biometric/PIN → passkey appears in the list
11. Sign out → on `/sign-in` click "Use a passkey" → biometric prompt → 2FA still required → land on dashboard

## Known follow-ups before merging to `main`

- [ ] Add SPF + DKIM + DMARC records for `onsective.com` so SMTP-sent OTPs don't land in spam
- [ ] Add Playwright e2e for sign-in → 2FA → dashboard, plus passkey enroll round-trip
- [ ] Thread auth/tenant/platform routers through `withTenant` / `withPlatformGod` so RLS becomes load-bearing
- [ ] Set up a separate non-superuser app DB role for production
- [ ] Generate real `.env` secrets and document rotation in `docs/04-security-and-compliance.md`

## Where to read next

- `docs/00-INDEX.md` — overall map
- `docs/phase-00-foundation.md` — full P0 spec (compare against this checklist)
- `docs/phase-01-tenant-billing.md` — what to build next
