# 04 — Security & Compliance

OnsecBoad processes Canadian immigration data: passports, biometrics, family info, financial records. Treat as Tier-1 sensitive PII. PIPEDA applies. CASL applies to all marketing comms.

## Threat model (top risks)

| Risk | Mitigation |
|---|---|
| Tenant data leak (cross-firm) | Postgres RLS + tenant middleware + integration tests that try to break it |
| Account takeover | 2FA mandatory, passkey support, suspicious-login alerts, rate limiting |
| Stolen DB backup | Backups encrypted at rest with KMS key not co-located with DB host |
| Lost laptop with creds | Short-lived tokens, device list with revoke, no plaintext secrets in repo |
| Insider abuse | Append-only `AuditLog`, separate read-replica for ops queries, role separation |
| Phishing of clients | DKIM/DMARC strict, SPF lockdown, branded emails only via Resend, magic-link expiry 15min |
| Document tampering | R2 object versioning + content hash stored in DB; audit trail on retainer |
| Supply chain | `pnpm audit` on CI, lockfile pinned, Dependabot, SBOM generated per release |
| DoS | Cloudflare WAF + rate limits per endpoint + per-IP + per-tenant |
| Webhook spoofing | Signature verification mandatory (Stripe, Twilio, Meta) |

## Secrets management

- Local dev: `.env.local` (gitignored). `.env.example` lists keys with dummy values.
- CI: GitHub Actions encrypted secrets.
- Prod: secrets injected via Docker Compose `env_file` from `/etc/onsecboad/secrets.env` (root-owned, 600 perms).
- Encrypted columns (`twoFASecret`, `twilio.authToken`): AES-256-GCM with key in env, not DB.
- Rotation cadence:
  - JWT signing key: every 90 days (rolling kid header)
  - DB password: 180 days
  - API keys (Stripe, Twilio, Anthropic): 365 days or on incident
  - R2 access key: 180 days

## PIPEDA checklist (Canadian privacy)

- [ ] Privacy policy published and linked from footer + intake forms
- [ ] Consent captured at intake (purpose, retention, third-party sharing) — stored as part of `IntakeSubmission`
- [ ] Data subject access — Law Firm Admin can export client data (Phase 10)
- [ ] Right to deletion — soft-delete then hard-delete after 30-day grace; legal hold flag for cases under regulatory review
- [ ] Breach notification process — runbook in `infra/runbooks/breach.md`
- [ ] Data residency — Postgres + R2 in Canada (or US with PIPEDA addendum); document in privacy policy
- [ ] Encryption in transit (TLS 1.3 only) and at rest (LUKS on VPS volume + R2 SSE)
- [ ] Sub-processor list maintained: Cloudflare, Hostinger, Stripe, Twilio, Resend, Anthropic

## CASL (Canadian anti-spam) checklist

- [ ] Express consent recorded for marketing emails/SMS — audit trail on Lead/Client
- [ ] One-click unsubscribe in every marketing email
- [ ] Sender identification in footer of every message
- [ ] Telecaller "Do Not Call" registry honored — Lead has `dncFlag`
- [ ] Suppression list across tenant (campaigns can't override)

## OWASP top-10 controls

- A01 Broken Access Control: tenant middleware + RBAC tests are mandatory CI
- A02 Crypto failures: argon2id for passwords, no MD5/SHA1 anywhere, TLS-only
- A03 Injection: Prisma parameterized queries; no raw SQL except in migrations
- A04 Insecure Design: threat-model review per phase; PR template asks "what's the abuse case?"
- A05 Security Misconfig: hardened Docker images (distroless where possible), no debug in prod
- A06 Vulnerable Components: Dependabot weekly, severity-9 patched within 24h
- A07 Auth Failures: account lockout after 5 failed attempts, captcha on portal sign-in
- A08 Data Integrity: signed SBOM, image signatures (cosign)
- A09 Logging Failures: structured logs to Loki, no PII in logs (scrubbing middleware)
- A10 SSRF: URL allowlist for outbound HTTP from server-side fetches

## Audit trail (mandatory events)

Every one of these emits an `AuditLog` row:

- Auth: sign-in (success/failure), sign-out, 2FA setup/change, passkey added/removed, password reset
- User: invite, role change, disable, delete
- Tenant: create, suspend, plan change, branding change, integration creds change
- Lead: create (source noted), assign, status change, delete
- Client: create, edit (diff payload), delete
- Case: create, status change, filer change, lawyer change, IRCC field set
- Document: upload, version supersession, delete, download (who downloaded what)
- Retainer: send, view, sign, decline
- Billing: invoice create, payment recorded, refund
- Platform admin "god mode" use: every action

## Backup & disaster recovery

- Postgres: `pg_basebackup` nightly + WAL archiving. RPO ≤ 5 min, RTO ≤ 1 hour.
- R2: object versioning + 30-day delete protection.
- Restore drill: quarterly. Document time-to-restore in `infra/runbooks/restore.md`.

## Rate limits (defaults — per-tenant override possible)

| Endpoint group | Anonymous | Authenticated | Per-tenant cap |
|---|---|---|---|
| `/api/v1/leads/ingest` | n/a (key required) | 60/min/key | 10000/day/tenant |
| `/auth/*` | 10/min/IP | n/a | n/a |
| `/api/trpc/*` | n/a | 600/min/user | 60000/min/tenant |
| Public intake form submit | 5/min/IP | n/a | 1000/day/tenant |
| Webhooks (inbound) | unlimited (signed) | n/a | n/a |

## CSP & headers

- `Content-Security-Policy`: strict, nonce-based; allowlist Cloudflare R2, Stripe.js, Twilio Voice SDK
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(self), geolocation=(self)` (mic for Twilio softphone)
- `X-Frame-Options: DENY` (except client portal embed page if needed)
