#!/usr/bin/env bash
# pg_restore.sh — fetch + decrypt + restore a backup into a target DB.
#
# Pulls a specific backup key (or "latest") from R2, decrypts it, and runs
# pg_restore against the target database. Designed for two use cases:
#
#   1. Disaster recovery — restore latest backup to a fresh prod database.
#   2. Restore drill — same flow into a temp database for verification
#      (called by restore_drill.sh).
#
# Required env (sourced from /etc/onsec/backup.env):
#   PGHOST, PGPORT, PGUSER, PGDATABASE   - target DB connection
#   BACKUP_PASSPHRASE                    - same passphrase used for backup
#   R2_BUCKET                            - bucket name
#
# Usage:
#   bash pg_restore.sh latest          # most recent backup
#   bash pg_restore.sh KEY             # specific backup key (e.g. postgres/onsecboad-...)
#
# IMPORTANT: this drops every existing object in the target database. Run
# against a fresh DB only.

set -euo pipefail

: "${PGHOST:?PGHOST required}"
: "${PGPORT:?PGPORT required}"
: "${PGUSER:?PGUSER required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE required}"
: "${R2_BUCKET:?R2_BUCKET required}"

TARGET="${1:-latest}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ "$TARGET" == "latest" ]]; then
  echo "==> resolving latest backup key"
  REMOTE_KEY=$(rclone lsf "r2-backup:$R2_BUCKET/postgres/" \
    --include "onsecboad-*.dump.enc" \
    --files-only \
    | sort \
    | tail -1)
  if [[ -z "$REMOTE_KEY" ]]; then
    echo "no backups found"
    exit 1
  fi
  REMOTE_KEY="postgres/$REMOTE_KEY"
else
  REMOTE_KEY="$TARGET"
fi

echo "==> fetching $REMOTE_KEY"
ENC_PATH="$TMP_DIR/$(basename "$REMOTE_KEY")"
rclone copyto "r2-backup:$R2_BUCKET/$REMOTE_KEY" "$ENC_PATH"

DUMP_PATH="${ENC_PATH%.enc}"
echo "==> decrypting"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$ENC_PATH" -out "$DUMP_PATH" \
  -pass "env:BACKUP_PASSPHRASE"

echo "==> restoring into $PGDATABASE @ $PGHOST"
# --clean drops existing objects, --if-exists silences the warnings on a
# fresh DB. --no-owner avoids GRANTing roles that don't exist on the
# target. -j 4 parallelises restore — bump on bigger boxes.
pg_restore \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  --exit-on-error \
  "$DUMP_PATH"

echo "==> restore complete. validating row counts…"
psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname="$PGDATABASE" \
  -c "SELECT COUNT(*) FROM \"Tenant\";" \
  -c "SELECT COUNT(*) FROM \"User\";" \
  -c "SELECT COUNT(*) FROM \"Case\";" \
  -c "SELECT COUNT(*) FROM \"AuditLog\";"

echo "==> done."
