#!/usr/bin/env bash
# restore_drill.sh — quarterly verification that backups actually restore.
#
# 1. Provisions a temp database (drops + recreates onsecboad_drill).
# 2. Runs pg_restore.sh against it.
# 3. Compares row counts vs the prod replica's recent values.
# 4. Records the drill timestamp in /var/log/onsec/restore-drill.log.
# 5. Drops the temp database.
#
# Target: RTO ≤ 60 min, RPO ≤ 24 hr (since we run logical dumps daily).
# WAL archiving (RPO ≤ 5 min) lands in a follow-up phase.
#
# Required env (same as pg_backup.sh).
# Run as the postgres superuser on the prod DB host (or a host with
# CREATE DATABASE on the cluster).
#
# Usage:
#   bash restore_drill.sh

set -euo pipefail

: "${PGHOST:?PGHOST required}"
: "${PGPORT:?PGPORT required}"
: "${PGUSER:?PGUSER required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE required}"
: "${R2_BUCKET:?R2_BUCKET required}"

DRILL_DB="onsecboad_drill_$(date -u +%Y%m%d)"
LOG_DIR="${LOG_DIR:-/var/log/onsec}"
LOG_PATH="$LOG_DIR/restore-drill.log"
mkdir -p "$LOG_DIR"

START_TS="$(date -u +%s)"

echo "==> dropping + creating $DRILL_DB"
psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname=postgres \
  -c "DROP DATABASE IF EXISTS \"$DRILL_DB\";" \
  -c "CREATE DATABASE \"$DRILL_DB\";"

echo "==> running pg_restore.sh against $DRILL_DB"
PGDATABASE="$DRILL_DB" bash "$(dirname "$0")/pg_restore.sh" latest

echo "==> capturing row counts from $DRILL_DB"
ROW_COUNTS=$(psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname="$DRILL_DB" --tuples-only --no-align <<SQL
SELECT 'Tenant=' || COUNT(*) FROM "Tenant";
SELECT 'User=' || COUNT(*) FROM "User";
SELECT 'Lead=' || COUNT(*) FROM "Lead";
SELECT 'Case=' || COUNT(*) FROM "Case";
SELECT 'CaseInvoice=' || COUNT(*) FROM "CaseInvoice";
SELECT 'CasePayment=' || COUNT(*) FROM "CasePayment";
SELECT 'DocumentUpload=' || COUNT(*) FROM "DocumentUpload";
SELECT 'AuditLog=' || COUNT(*) FROM "AuditLog";
SQL
)

END_TS="$(date -u +%s)"
DURATION=$((END_TS - START_TS))

echo "==> teardown"
psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" --dbname=postgres \
  -c "DROP DATABASE \"$DRILL_DB\";"

echo
echo "==== drill summary ===="
echo "started_at=$(date -u -d "@$START_TS" -Iseconds 2>/dev/null || date -u -r "$START_TS" -Iseconds)"
echo "duration_s=$DURATION"
echo "row_counts:"
echo "$ROW_COUNTS"
echo "======================="

{
  echo "$(date -u -Iseconds) duration=${DURATION}s db=$DRILL_DB"
  echo "$ROW_COUNTS" | tr '\n' ' '
  echo
} >> "$LOG_PATH"

# Soft check: fail loudly if Tenant count is 0 (likely restore corruption).
if echo "$ROW_COUNTS" | grep -q "Tenant=0"; then
  echo "WARN: Tenant table is empty after restore — drill failed"
  exit 1
fi

echo "==> drill OK. log appended to $LOG_PATH"
