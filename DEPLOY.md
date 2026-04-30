# OnsecBoad — Production deploy (Hostinger VPS + CloudPanel)

End-to-end: from a fresh VPS to `https://onsective.cloud` working.

> **Architecture:** CloudPanel's nginx is the public-facing reverse proxy
> + Let's Encrypt SSL. The app runs as Docker Compose, listening only on
> `127.0.0.1` so the only way in is through CloudPanel.

---

## 1. Hostinger VPS prep

1. **Pick a plan** with ≥ 2 vCPU, 4GB RAM, 50GB disk. (KVM 2 or higher.)
2. During provisioning select the **CloudPanel** template (Hostinger offers it as a pre-configured OS image).
3. Set up SSH access and harden basics:
   ```bash
   ssh root@your-vps-ip
   adduser onsec
   usermod -aG sudo onsec
   usermod -aG docker onsec
   ufw allow OpenSSH
   ufw allow 'Nginx Full'      # CloudPanel uses this
   ufw enable
   ```
4. Confirm Docker + Compose are installed:
   ```bash
   docker --version
   docker compose version
   ```
   (CloudPanel's image ships with both. If missing: `curl -fsSL https://get.docker.com | sh`.)

## 2. DNS — point `onsective.cloud` at the VPS

In your DNS provider (Cloudflare, Hostinger DNS, wherever):

| Record | Type | Value | TTL |
|---|---|---|---|
| `onsective.cloud` | A | YOUR_VPS_IP | Auto |
| `api.onsective.cloud` | A | YOUR_VPS_IP | Auto |
| `www.onsective.cloud` | CNAME | `onsective.cloud` | Auto (optional) |

If using Cloudflare, **set the proxy to "DNS only" (gray cloud)** for now —
the orange-cloud proxy interferes with Let's Encrypt's HTTP-01 challenge that
CloudPanel uses. You can flip to orange after the cert is issued.

Wait for DNS to propagate (`dig onsective.cloud +short` should return your VPS IP).

## 3. CloudPanel — create the two reverse-proxy sites

Log in to CloudPanel (default `https://YOUR_VPS_IP:8443`).

**Site 1: `onsective.cloud` (the web app)**
- Sites → Add Site → **Reverse Proxy**
- Domain: `onsective.cloud` (also add `www.onsective.cloud` if you set that up)
- Reverse Proxy URL: `http://127.0.0.1:4001`
- Save

**Site 2: `api.onsective.cloud` (the API)**
- Sites → Add Site → **Reverse Proxy**
- Domain: `api.onsective.cloud`
- Reverse Proxy URL: `http://127.0.0.1:4000`
- Save

After both sites exist, on each one:
- **Vhost** tab → ensure `client_max_body_size 10M;` is set (for invoice PDFs and future doc uploads).
- **SSL/TLS** tab → click **Actions → New Let's Encrypt Certificate**. Should issue in ~30 seconds.

> **Stripe webhook caveat:** the Stripe webhook signature requires the raw
> body to reach the API unmodified. CloudPanel's default nginx config is
> fine, but if you ever add nginx-level body modifications (gzip, rewrite),
> exclude `/api/v1/webhooks/stripe` from them.

## 4. Clone + configure

```bash
ssh onsec@your-vps-ip
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/onsectivewebsite/ions.git onsecboad
cd onsecboad

cp .env.production.example .env.production

# Generate strong secrets — paste into .env.production on the corresponding lines
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 32)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY_BASE64=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"

nano .env.production   # fill SMTP_PASSWORD, Stripe keys (or leave dry-run), etc.
```

## 5. Build + start

```bash
docker compose -f infra/docker/compose.prod.yml --env-file .env.production up -d --build
docker compose -f infra/docker/compose.prod.yml --env-file .env.production ps
```

You should see four containers: postgres, redis, api, web — all healthy.

## 6. Migrate + seed

First boot:

```bash
# Apply schema migrations
docker compose -f infra/docker/compose.prod.yml --env-file .env.production exec api \
  pnpm --filter @onsecboad/db exec prisma migrate deploy

# Seed plans + superadmin + demo tenant
docker compose -f infra/docker/compose.prod.yml --env-file .env.production exec api \
  pnpm db:seed
```

The seed prints the initial superadmin password — write it down, change it on first login.

## 7. Smoke test

```bash
curl https://api.onsective.cloud/api/health
# → {"ok":true}

curl https://api.onsective.cloud/api/ready
# → {"ok":true,"checks":{"db":"ok","redis":"ok"}}
```

Open `https://onsective.cloud/sign-in` — sign in with the superadmin email
from the seed output.

## 8. Stripe webhook (when going live)

In Stripe Dashboard → Developers → Webhooks → **Add endpoint**:
- URL: `https://api.onsective.cloud/api/v1/webhooks/stripe`
- Events: `customer.subscription.*`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`
- Copy the signing secret → put in `.env.production` as `STRIPE_WEBHOOK_SECRET` → `docker compose ... up -d` to apply

Flip `STRIPE_DRY_RUN=false` only after the webhook is wired and tested.

## 9. Updates (deploys after the first one)

```bash
ssh onsec@your-vps-ip
cd ~/apps/onsecboad
git pull
docker compose -f infra/docker/compose.prod.yml --env-file .env.production up -d --build
# Apply any new migrations
docker compose -f infra/docker/compose.prod.yml --env-file .env.production exec api \
  pnpm --filter @onsecboad/db exec prisma migrate deploy
```

## 10. Backups

Add a daily Postgres dump to cron:

```bash
sudo crontab -u onsec -e
```
```
0 3 * * * docker exec onsec-postgres-prod pg_dump -U onsec onsecboad | gzip > ~/backups/onsecboad-$(date +\%F).sql.gz
0 4 * * 0 find ~/backups/ -name "onsecboad-*.sql.gz" -mtime +30 -delete
```

R2 backups for object storage will land alongside Phase 6 (documents).

## 11. Logs

```bash
docker compose -f infra/docker/compose.prod.yml --env-file .env.production logs -f api
docker compose -f infra/docker/compose.prod.yml --env-file .env.production logs -f web
```

CloudPanel's nginx access/error logs:
- `/home/cloudpanel/logs/onsective.cloud/access.log`
- `/home/cloudpanel/logs/api.onsective.cloud/error.log`

## Common gotchas

- **Cloudflare orange-cloud breaks Let's Encrypt** — keep DNS-only until the cert is issued.
- **Mismatched WEBAUTHN_RP_ID** — must be exactly `onsective.cloud` (no protocol, no port). Passkeys silently fail otherwise.
- **`SMTP_PASSWORD` placeholder** — emails fail with `535 5.7.8`. Set the real Hostinger mailbox password.
- **Compose port already in use on 4000/4001** — make sure no other dev process is running on the VPS. `lsof -ti:4000,4001`.
- **Prisma binary mismatch** — the schema's `binaryTargets` already covers `linux-musl-openssl-3.0.x`. If you swap to a non-Alpine base image, regenerate the client.
