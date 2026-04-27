# Phase 0 — Foundation

> **Goal:** A deployable, empty product with multi-tenant Postgres, working auth (password + passkey + 2FA), tenant branding/theme engine, and the Onsective platform-manager superuser able to create a tenant manually via DB seed.
>
> **"Done" when:** A platform manager can sign in with 2FA, see "Law Firms (0)", and a seeded test tenant's Law Firm Admin can sign in to a themed empty dashboard with role-appropriate side nav.

## Routes (frontend URLs)

| URL | Who | What |
|---|---|---|
| `/sign-in` | anyone | email+pw OR passkey, then 2FA |
| `/sign-in/2fa` | mid-auth user | TOTP or email OTP |
| `/sign-in/forgot` | anyone | password reset request |
| `/reset/[token]` | reset link recipient | new password |
| `/p/dashboard` | Onsective platform manager | placeholder dashboard |
| `/p/firms` | platform manager | list (empty in P0) |
| `/p/users` | platform manager | manage other Onsective platform users |
| `/p/audit` | platform manager | audit log viewer |
| `/p/settings` | platform manager | system settings |
| `/f/dashboard` | firm staff (any role) | placeholder dashboard |
| `/f/settings/branding` | Firm Admin | theme picker + logo upload |
| `/f/settings/profile` | any user | personal profile + 2FA enroll |
| `/f/settings/sessions` | any user | active devices |

## API surface

### tRPC procedures

```
auth.signIn({email, password})              → {requires2FA, twoFAMethods, ticket}
auth.signInWithPasskey()                    → {ticket}
auth.verify2FA({ticket, code, method})      → {accessToken, refreshToken}
auth.requestEmailOtp({ticket})              → ok
auth.signOut()                              → ok
auth.passwordReset.request({email})         → ok
auth.passwordReset.confirm({token, pw})     → ok

user.me()                                   → {id, role, tenant, branding}
user.updateProfile(input)                   → User
user.passkey.list()                         → Passkey[]
user.passkey.beginRegistration()            → options
user.passkey.finishRegistration(att)        → Passkey
user.passkey.delete({id})                   → ok
user.totp.beginEnroll()                     → {secret, qr}
user.totp.confirmEnroll({code})             → ok
user.totp.disable({code})                   → ok
user.sessions.list()                        → Session[]
user.sessions.revoke({id})                  → ok

tenant.branding.get()                       → branding json
tenant.branding.update(input)               → branding json
tenant.uploadLogo()                         → presigned URL

platform.tenant.list({page, q})             → paginated
platform.tenant.create(input)               → Tenant   // CLI/seed for P0; UI in P1
platform.user.list()                        → PlatformUser[]
platform.user.invite({email, name})         → ok
platform.audit.list({filters})              → paginated AuditLog
```

### REST

- `GET /api/health` — liveness
- `GET /api/ready` — readiness (DB, Redis ping)
- `POST /api/webhooks/_test` — placeholder

## Database changes

Tables introduced in this phase (per `02-data-model.md`):
- `PlatformUser`, `Tenant`, `Branch`, `User`, `Role`, `Passkey`, `Session`, `AuditLog`

Seed data:
- 1 superadmin PlatformUser (`onsectivesoftware@outlook.com`)
- 6 system Roles per tenant (FIRM_ADMIN, BRANCH_MANAGER, LAWYER, CONSULTANT, FILER, CASE_MANAGER, TELECALLER, RECEPTIONIST)
- 1 demo tenant `acme-immigration` with admin `admin@acme.test` and a single branch

## Background jobs

| Job | Purpose |
|---|---|
| `email-send` | Resend wrapper used by reset, OTP, invite |
| `audit-flush` | Optional batched audit log writer if volume grows |

## UI Wireframes

### Sign-in page (`/sign-in`)

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│                       [Logo]  OnsecBoad                            │
│                                                                    │
│        ┌────────────────────────────────────────────────┐          │
│        │  Sign in to your account                       │          │
│        │                                                │          │
│        │  Email                                         │          │
│        │  ┌──────────────────────────────────────────┐  │          │
│        │  │ you@firm.com                              │  │          │
│        │  └──────────────────────────────────────────┘  │          │
│        │                                                │          │
│        │  Password                          [👁 show]   │          │
│        │  ┌──────────────────────────────────────────┐  │          │
│        │  │ ••••••••                                  │  │          │
│        │  └──────────────────────────────────────────┘  │          │
│        │                                                │          │
│        │           [    Sign in   ]                     │          │
│        │                                                │          │
│        │  ───────────  or  ───────────                  │          │
│        │                                                │          │
│        │      [ 🔑 Use a passkey ]                      │          │
│        │                                                │          │
│        │  Forgot password?  ·  Need help?               │          │
│        └────────────────────────────────────────────────┘          │
│                                                                    │
│                    Onsective Inc. · Privacy · Terms                │
└────────────────────────────────────────────────────────────────────┘
```

NOTE: There is **no** "Sign up" link anywhere. Account creation is admin-driven only.

### 2FA page (`/sign-in/2fa`)

```
┌────────────────────────────────────────────────────────────────────┐
│        ┌────────────────────────────────────────────────┐          │
│        │  Two-factor verification                       │          │
│        │                                                │          │
│        │  Method  [▼ Authenticator app    ]             │  ← dropdown DOWN-START
│        │            ┌─────────────────────────────┐     │     options:
│        │            │ Authenticator app (TOTP) ✓ │     │     • Authenticator (TOTP)
│        │            │ Email one-time code         │     │     • Email OTP
│        │            └─────────────────────────────┘     │
│        │                                                │
│        │  6-digit code                                  │          │
│        │  ┌──┬──┬──┬──┬──┬──┐                            │          │
│        │  │  │  │  │  │  │  │                            │          │
│        │  └──┴──┴──┴──┴──┴──┘                            │          │
│        │                                                │          │
│        │           [   Verify   ]                       │          │
│        │                                                │          │
│        │  Lost your device? Contact your firm admin.    │          │
│        └────────────────────────────────────────────────┘          │
└────────────────────────────────────────────────────────────────────┘
```

### Platform manager dashboard placeholder (`/p/dashboard`)

Standard shell from `03-design-system.md` section A. Side nav per role. Body shows 4 stat cards (Firms total / Active / Suspended / MRR — all 0 in P0) and an empty audit log list.

### Firm Admin dashboard placeholder (`/f/dashboard`)

Same shell, themed per tenant branding. Body: empty state "Your firm is set up. Next: invite your team in Settings → Users (coming in Phase 2)."

### Settings → Branding (`/f/settings/branding`)

```
┌────────────────────────────────────────────────────────────────────┐
│ Settings › Branding                                                │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Theme preset                                                      │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐                  │
│  │Mple│ │Glcr│ │Frst│ │Slte│ │Aurr│ │Mdnt│ │Cstm│                  │
│  │ ●  │ │    │ │    │ │    │ │    │ │    │ │    │                  │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘                  │
│                                                                    │
│  Custom color (only if Custom selected)                            │
│  Primary  [ #B5132B ] [▭] ← color swatch opens picker popover      │
│                                                                    │
│  Logo                                                              │
│  ┌──────────────────┐                                              │
│  │ Drag & drop here │   PNG/SVG, max 1MB, square preferred         │
│  │ or [ Choose file ]│                                              │
│  └──────────────────┘                                              │
│                                                                    │
│  Live preview                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ [Logo] OnsecBoad                                  [Avatar ▼]│  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  Sample content using the chosen theme tokens...             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│                                            [ Cancel ] [ Save ]     │
└────────────────────────────────────────────────────────────────────┘
```

### Profile / 2FA enroll (`/f/settings/profile`)

Sections (vertical):
1. **Profile**: name, email (readonly), phone, language preference
2. **Two-factor authentication**: status badge + buttons to set up TOTP or rotate; lists active methods
3. **Passkeys**: table with name, device, last used, [Remove] action; button [+ Add a passkey]
4. **Active sessions**: list with device, IP (geo-mask last octet), last seen, [Revoke]

## CRUD permission matrix

| Entity | Action | Onsective | FirmAdmin | BranchMgr | Lawyer | Consultant | Filer | Telecaller | Recept |
|---|---|---|---|---|---|---|---|---|---|
| PlatformUser | C/R/U/D | ✓ | — | — | — | — | — | — | — |
| Tenant | C | ✓ | — | — | — | — | — | — | — |
| Tenant | R (own) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tenant.branding | U | ✓ | ✓ | — | — | — | — | — | — |
| User (own profile) | R/U | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| User (others) | C/R/U/D | — | (P2) | (P2 own branch) | — | — | — | — | — |
| Passkey (own) | C/R/D | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Session (own) | R/D | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| AuditLog | R | all | own tenant | own branch | — | — | — | — | — |

## Debug / observability hooks

- **Auth events**: every sign-in attempt logged with ip, ua, success bool, fail reason; alert > 10 fails / 5min / IP.
- **2FA bypass attempts**: if `verify2FA` is called with mismatched ticket, log + counter metric.
- **Tenant context**: every tRPC call logs `tenantId` + `userId` + `procedure` + `latencyMs`.
- **Theme load**: client logs theme hash; mismatch with server → toast + reload.
- **Passkey ceremony**: log start + finish; failure rates by browser.
- **Health endpoints**: `/api/health` → 200 always; `/api/ready` → 503 if DB/Redis down.

## Performance budget

- Sign-in TTFB < 250ms
- Dashboard first paint < 1.5s
- Theme bundle: < 5KB CSS variables only; no per-theme JS
- Passkey ceremony p95 < 800ms

## Acceptance criteria

- [ ] `pnpm install && pnpm dev` brings up web on `:3000`, api on `:4000`
- [ ] `pnpm db:migrate && pnpm db:seed` succeeds; superadmin + demo tenant present
- [ ] Sign in with seeded superadmin → 2FA challenge → dashboard
- [ ] Sign in with seeded firm admin → dashboard themed with default Maple
- [ ] Switch theme to Glacier → save → reload → theme persists
- [ ] Add passkey → sign out → sign in with passkey → 2FA still required → dashboard
- [ ] Wrong password 5x in 1min triggers lockout (15min)
- [ ] Audit log shows: sign-in success, sign-in fail, theme change
- [ ] All endpoints reject if no auth; all tRPC scoped by `tenantId` (integration test passes cross-tenant isolation)
- [ ] Lighthouse on `/sign-in`: Performance ≥ 95, Accessibility ≥ 95
- [ ] Docker Compose up on a clean VM brings the stack online; Cloudflare tunnel routes `app.onsecboad.com` to it
- [ ] Backups: `pg_dump` script runs; restore tested locally

## Resume checkpoint (what should exist on disk)

```
onsecboad/
├── package.json, pnpm-workspace.yaml, turbo.json, .env.example
├── apps/web/            # Next.js with sign-in, 2FA, dashboards (placeholders), branding settings
├── apps/api/            # tRPC server, REST health, webhook stub
├── packages/db/         # Prisma schema with P0 tables, migrations, seed.ts
├── packages/auth/       # signIn, verify2FA, passkey, totp helpers
├── packages/ui/         # shadcn primitives + theme provider + logo uploader
├── packages/tenancy/    # middleware that sets app.tenant_id on connection
├── packages/config/     # env zod schema + theme presets
├── infra/docker/        # Dockerfiles + compose.yml (postgres, redis, web, api)
├── infra/cloudflare/    # tunnel config
└── .github/workflows/   # ci.yml (lint, type, test, build), deploy-staging.yml
```

When you sit back down: run `pnpm dev` then visit `localhost:3000/sign-in`. If sign-in works end-to-end with the seeded user → Phase 0 is done; jump to Phase 1.
