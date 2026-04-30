#!/bin/bash
# OnsecBoad one-shot prod redeploy. Run as root.
#
# Pulls latest on both site repos, installs deps, runs migrations,
# rebuilds the web bundle, restarts both systemd services.
#
# Install once: cp infra/scripts/deploy-prod.sh /usr/local/bin/onsec-deploy && chmod +x /usr/local/bin/onsec-deploy
# Then run: onsec-deploy
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root" >&2
  exit 1
fi

API_DIR=/home/ions-api/htdocs/api.onsective.cloud
WEB_DIR=/home/ions/htdocs/onsective.cloud

echo "==> [1/4] API: git pull + install + prisma migrate"
sudo -u ions-api -H bash -lc "
  set -e
  cd $API_DIR
  git pull --ff-only
  pnpm install --no-frozen-lockfile
  pnpm --filter @onsecboad/db exec prisma migrate deploy
"

echo "==> [2/4] Web: git pull + install + build"
sudo -u ions -H bash -lc "
  set -e
  cd $WEB_DIR
  git pull --ff-only
  pnpm install --no-frozen-lockfile
  cp .env apps/web/.env
  pnpm --filter @onsecboad/web build
"

echo "==> [3/4] Restart services"
systemctl restart onsec-api
systemctl restart onsec-web
sleep 4

echo "==> [4/4] Status"
systemctl status onsec-api --no-pager | head -5
echo
systemctl status onsec-web --no-pager | head -5

echo
echo "Deploy complete."
