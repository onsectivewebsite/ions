# Secret rotation runbook

> Rotate every secret class. Schedule annually OR within 24h of a
> suspected compromise.

Each section: **what**, **how**, **blast radius**, **verification**.

## JWT signing secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`)

**What**: HS256 signing keys for access + refresh tokens.

**How**:
1. Generate a new 64-byte secret: `openssl rand -hex 64`.
2. Update `.env` on the prod API host.
3. Rolling restart of the API: every existing session immediately invalidates.
4. Notify firm admins to expect a forced sign-out.

**Blast radius**: every signed-in user (web + mobile + TV + portal) is logged out. ~5 min of help-desk traffic. Live SSE connections drop and reconnect.

**Verification**: hit `/api/health` (should be 200) and try to sign in fresh.

## Stripe webhook secret (`STRIPE_WEBHOOK_SECRET`)

**What**: HMAC secret Stripe uses to sign webhook deliveries.

**How**:
1. In Stripe Dashboard → Developers → Webhooks → endpoint → "Roll signing secret".
2. Stripe shows the new secret ONCE — copy it.
3. Update `.env` on the prod API host. Restart API.
4. Stripe maintains the old secret for 24 hours by default, so there's a grace window for in-flight events.

**Blast radius**: zero, if you complete step 3 within 24h. Otherwise webhooks start failing signature verification + Stripe retries until the queue is full.

**Verification**: trigger a test webhook from Stripe ("Send test webhook") and watch the API logs for `stripe webhook duplicate, ack` or success.

## Stripe API keys (`STRIPE_SECRET_KEY`)

**What**: server-side Stripe API access.

**How**:
1. Stripe Dashboard → Developers → API keys → roll the secret key.
2. Update `.env` + restart API.
3. Verify the publishable key (`STRIPE_PUBLISHABLE_KEY`) is unchanged — it goes to the browser via `billing.config` and a mismatch breaks card capture.

**Blast radius**: in-flight Stripe operations during the rotation second fail. Negligible for our volume.

**Verification**: open `/p/firms/[id]/Subscription` and verify the live card form still mounts.

## Twilio per-firm credentials

**What**: Each firm carries encrypted Twilio creds in `Tenant.twilio`.

**How**: per-firm rotation, not platform-level. Firm admin signs in → Settings → Integrations → Twilio → enter new SID + token. The old creds are replaced atomically.

**Blast radius**: zero (per-firm).

**Verification**: place a test call from `/leads/[id]` against the firm. Recording webhook should fire under the new creds.

## R2 access keys

**What**: rclone + the API both use these. **Two separate key pairs**: one for the documents bucket (read+write from API), one for the backup bucket (write-only from backup host, read+write from restore host).

**How**:
1. Cloudflare Dashboard → R2 → Manage API tokens → create a new key with the right scope.
2. Verify with rclone: `rclone lsd r2-documents:` and `rclone lsd r2-backup:` from each respective host.
3. Update `.env` on the prod API host. Restart API.
4. Update `/etc/onsec/backup.env` on the backup host.
5. **Then** revoke the old token in Cloudflare.

**Blast radius**: if you revoke before rolling out: every signed-URL fetch + every upload starts 403'ing immediately. Run the rotation in the order above.

**Verification**: trigger an invoice PDF render via the staff UI. Watch for the R2 upload + signed-URL serve to succeed. Run `bash infra/scripts/pg_backup.sh` on the backup host.

## Postgres credentials

**What**: app-role password (NOT the superuser).

**How**:
1. `psql` as superuser: `ALTER ROLE onsec_app PASSWORD '<new>';`
2. Update `DATABASE_URL` in `.env` on the API host. Rolling restart.
3. `pg_basebackup` user is separate — rotate that on the backup host independently.

**Blast radius**: API briefly errors during restart (~5s). Existing pooled connections close.

**Verification**: `/api/ready` returns 200 with `db: 'ok'`.

## Anthropic API key

**What**: Claude access for AI extraction / classify / summarize / agent.

**How**:
1. Anthropic Console → API Keys → create new key.
2. Update `.env` (`ANTHROPIC_API_KEY=sk-ant-…`). Restart API.
3. Revoke old key in console.

**Blast radius**: AI calls in flight during the rotation second may fail. The AI helper retries best-effort.

**Verification**: trigger `caseAi.run` on a test case; check `AiUsage` row appears with the new model + `mode: 'real'`.

## Backup passphrase (`BACKUP_PASSPHRASE`)

**What**: AES-256-CBC passphrase for encrypted backups.

**How**:
1. **You can NOT roll this without re-encrypting historical backups** — the existing backups are useless without the old passphrase. Plan accordingly:
   - Generate new passphrase.
   - Stage it alongside the old: encrypt new daily backups under both for a transition window (custom script change required).
   - After RETAIN_DAYS, drop the old passphrase + retire dual-encryption.
2. Update `/etc/onsec/backup.env` only after at least 24h of dual-encrypted backups have rolled.

**Blast radius**: bricked backups if the old passphrase is lost mid-rotation. Treat as P0.

**Verification**: run `restore_drill.sh` against a freshly-encrypted backup. Then run it against an old-passphrase backup (using the saved old passphrase). Both must succeed.

## SMTP password (Hostinger `donotreply@onsective.com`)

**What**: outbound transactional email auth.

**How**:
1. Hostinger hPanel → Email Accounts → reset password.
2. Update `EMAIL_*` env vars + restart API.

**Blast radius**: outbound emails fail until the rotation completes. OTPs + invite emails in flight retry.

**Verification**: trigger a password reset; OTP arrives.

## Webhook verification secrets (Meta + TikTok)

Per-firm — same pattern as Twilio. Firm admin rotates in their own ad-platform console + updates the firm-side Settings → Integrations → Meta / TikTok page.

## Tracker

| Secret | Last rotated | Rotated by |
|---|---|---|
| `JWT_ACCESS_SECRET` | — | — |
| `JWT_REFRESH_SECRET` | — | — |
| `STRIPE_WEBHOOK_SECRET` | — | — |
| `STRIPE_SECRET_KEY` | — | — |
| `R2_ACCESS_KEY_ID` (documents) | — | — |
| `R2_ACCESS_KEY_ID` (backup) | — | — |
| `DATABASE_URL` password | — | — |
| `ANTHROPIC_API_KEY` | — | — |
| `BACKUP_PASSPHRASE` | — | — |
| SMTP | — | — |

Update this table on every rotation. Annual full-rotation review on each PIPEDA audit cycle.
