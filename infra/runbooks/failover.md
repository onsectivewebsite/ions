# Failover runbook

> Bring up a complete OnsecBoad stack on a fresh Hostinger VPS from cold.

**Use case**: the prod VPS is unrecoverable (hardware failure, account compromise, provider outage). We're replacing the box, not just the database.

**RTO target**: 4 hours from "fresh VPS provisioned" to "firms back online".

## Inventory check before you start

You need:
- Hostinger root SSH credentials for the new VPS
- DNS access (Hostinger hPanel or Cloudflare — whichever holds the `onsective.cloud` zone)
- `BACKUP_PASSPHRASE` (in 1Password / firm secret store)
- R2 backup credentials (separate from the documents-bucket creds)
- Stripe webhook endpoint secret
- Twilio webhook URL secrets per firm (mostly self-healing — Twilio reposts to whatever URL the firm config has)
- Anthropic API key (if AI is enabled)

## Step 1 — provision the box

CloudPanel image, Ubuntu 22.04, ≥ 4 GB RAM, ≥ 50 GB SSD. Open ports `80`, `443`, `22`. Lock SSH to key-only after first login.

```sh
# As root on the new box:
adduser onsec
usermod -aG sudo onsec
mkdir -p ~onsec/.ssh && chmod 700 ~onsec/.ssh
# Copy your public key into ~onsec/.ssh/authorized_keys
```

Install: docker, docker-compose-plugin, rclone, postgresql-client (`psql` + `pg_restore`), node 20, pnpm 9, git.

## Step 2 — pull the repo + secrets

```sh
sudo -u onsec git clone https://github.com/onsectivewebsite/ions /opt/onsec
cd /opt/onsec
sudo -u onsec pnpm install --frozen-lockfile
```

Drop `/etc/onsec/backup.env` and `.env` (root-only readable, mode 0600) with the values from your secret store. The repo's `.env.example` lists the required keys.

Configure rclone for both R2 buckets:
```sh
sudo -u onsec rclone config
# Add `r2-documents` (production R2 bucket) and `r2-backup` (separate
# backup-only bucket — different region if possible, separate creds).
```

## Step 3 — restore the database

```sh
# Bring up only Postgres + Redis first.
docker compose -f infra/docker/compose.yml up -d postgres redis
sleep 10

# Source secrets and restore.
source /etc/onsec/backup.env
bash infra/scripts/pg_restore.sh latest

# Apply any migrations newer than the dump.
pnpm --filter @onsecboad/db exec prisma migrate deploy
```

## Step 4 — bring up API + web

```sh
docker compose -f infra/docker/compose.yml up -d api web
```

Wait for healthchecks:
```sh
curl -fsS http://127.0.0.1:18080/   # web
curl -fsS http://127.0.0.1:18081/api/health
```

## Step 5 — DNS swap

Update A / AAAA records:
- `onsective.cloud` → new VPS IPv4
- `api.onsective.cloud` → new VPS IPv4

CloudPanel handles Let's Encrypt automatically; verify cert renewal with:
```sh
clpctl lets-encrypt:certificate:install --domainName=onsective.cloud
```

DNS propagation under typical TTL (300s) takes 1-15 minutes.

## Step 6 — webhooks + integrations

Most webhooks self-heal (Twilio + Meta retry on the URL the firm config has, which is unchanged). The exception is **Stripe** if the webhook secret is rotated:

```sh
# In the Stripe dashboard, the webhook endpoint URL is unchanged
# (https://api.onsective.cloud/api/v1/webhooks/stripe). The signing
# secret only changes if you rotate it — keep the existing one.
```

If you DID rotate, set `STRIPE_WEBHOOK_SECRET` in the new env and redeploy.

## Step 7 — smoke test

- Sign in to onsective.cloud as the platform admin
- Open one demo firm
- Hit a few mutation paths (create lead, create case, send a portal message)
- Verify SSE stream reconnects (`/api/v1/stream` should heartbeat every 25s)
- Check `/api/health/full` reports all components OK
- Check `/status` page

## Step 8 — comms

- Status page incident closed
- Email to all firm admins: "Service restored. Data current as of [backup timestamp]. If you logged any work between [timestamp] and [outage detected], please re-enter."
- Internal post-incident review scheduled within 72h.

## Common failures

- **DNS pointing at old IPv6**: Hostinger hands out shared AAAA records. Either delete them or migrate the zone to Cloudflare which lets you control AAAA explicitly.
- **`prisma migrate deploy` fails on RLS migration**: usually means the role grants are missing. Re-apply role provisioning before retrying.
- **Stripe webhook signature verification fails**: secret mismatch. Rotate in Stripe dashboard, update env, redeploy.
- **R2 documents 403**: rclone config didn't get the documents-bucket creds, or the bucket name is wrong in `.env` (`R2_BUCKET` for documents vs `R2_BUCKET` exported in backup.env for backups — keep them separate).
