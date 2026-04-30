#!/usr/bin/env bash
# pg_backup.sh — daily logical backup of the OnsecBoad Postgres → encrypted R2.
#
# What this does:
#   1. pg_dump in custom format (-Fc) — compressed, supports parallel restore.
#   2. AES-256 encrypt with openssl using BACKUP_PASSPHRASE.
#   3. Upload to R2 via rclone with timestamped key.
#   4. Verify upload by listing the resulting key.
#   5. Optional: prune backups older than RETAIN_DAYS.
#
# Run from cron on the prod API host (or a dedicated backup host with
# read replica access). Recommended schedule: 02:30 UTC daily, plus an
# hourly WAL archive job (separate script, not yet shipped).
#
# Assumptions:
#   - rclone is configured with a remote named `r2-backup` pointing at the
#     R2 bucket reserved for backups (NOT the documents bucket — different
#     region, different credentials, separate blast radius).
#   - openssl ≥ 1.1 (for `-pbkdf2 -iter`).
#   - BACKUP_PASSPHRASE is sourced from a secrets file with mode 0600.
#   - PGPASSWORD or ~/.pgpass is set so pg_dump doesn't prompt.
#
# Required env (set in /etc/onsec/backup.env, sourced before invocation):
#   PGHOST, PGPORT, PGUSER, PGDATABASE   - Postgres connection
#   BACKUP_PASSPHRASE                    - high-entropy passphrase
#   R2_BUCKET                            - bucket name (passed to rclone)
#   RETAIN_DAYS                          - default 30
#
# Usage:
#   bash pg_backup.sh
#
# Exit codes:
#   0 — backup uploaded + verified
#   1 — pg_dump failed
#   2 — encryption failed
#   3 — upload failed
#   4 — verification failed

set -euo pipefail

: "${PGHOST:?PGHOST required}"
: "${PGPORT:?PGPORT required}"
: "${PGUSER:?PGUSER required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE required}"
: "${R2_BUCKET:?R2_BUCKET required}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DUMP_PATH="$TMP_DIR/onsecboad-$TIMESTAMP.dump"
ENC_PATH="$DUMP_PATH.enc"
REMOTE_KEY="postgres/onsecboad-$TIMESTAMP.dump.enc"

echo "==> pg_dump $PGDATABASE @ $PGHOST"
pg_dump \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$DUMP_PATH" || { echo "pg_dump failed"; exit 1; }

DUMP_BYTES=$(stat -c%s "$DUMP_PATH" 2>/dev/null || stat -f%z "$DUMP_PATH")
echo "==> dump complete: $DUMP_BYTES bytes"

echo "==> encrypting (AES-256, PBKDF2)"
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in "$DUMP_PATH" -out "$ENC_PATH" \
  -pass "env:BACKUP_PASSPHRASE" || { echo "openssl enc failed"; exit 2; }
ENC_BYTES=$(stat -c%s "$ENC_PATH" 2>/dev/null || stat -f%z "$ENC_PATH")

echo "==> uploading to r2-backup:$R2_BUCKET/$REMOTE_KEY ($ENC_BYTES bytes)"
rclone copyto "$ENC_PATH" "r2-backup:$R2_BUCKET/$REMOTE_KEY" \
  --s3-no-check-bucket --retries 3 || { echo "rclone upload failed"; exit 3; }

echo "==> verifying upload"
rclone lsl "r2-backup:$R2_BUCKET/$REMOTE_KEY" | grep -q "$REMOTE_KEY" \
  || { echo "verification failed"; exit 4; }

if [[ "$RETAIN_DAYS" -gt 0 ]]; then
  echo "==> pruning backups older than $RETAIN_DAYS days"
  # rclone delete with min-age requires a slash-rooted path.
  rclone delete \
    "r2-backup:$R2_BUCKET/postgres/" \
    --min-age "${RETAIN_DAYS}d" \
    --include "onsecboad-*.dump.enc" \
    --rmdirs || true
fi

echo "==> done. key=$REMOTE_KEY"
