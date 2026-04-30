# Restore runbook

> Recovery from the daily encrypted Postgres backups in R2.

**RTO target**: 60 minutes from "decision to restore" to "API serving requests"
**RPO target**: 24 hours (logical dumps run daily; WAL archiving will tighten this when 10.2.x ships)

## When to invoke

- Production DB is corrupt, deleted, or otherwise unrecoverable.
- A restore drill is being run (use `restore_drill.sh` instead — it provisions a temp DB and tears it down).
- A bad migration / accidental delete needs a point-in-time rewind of one or more tables (in which case: restore latest into a side DB and `COPY` the affected rows into prod, don't replace prod wholesale).

## Pre-flight

1. **Stop writes** — pause CRON, scale the API to zero, freeze the firm-side UI:
   ```sh
   # On the prod API host:
   docker compose -f infra/docker/compose.yml stop api
   ```
2. **Confirm the latest backup is recent enough** for your RPO budget:
   ```sh
   rclone lsl r2-backup:$R2_BUCKET/postgres/ \
     --include "onsecboad-*.dump.enc" \
     | sort | tail -3
   ```
3. **Capture the current state** before destroying it (in case the "corruption" turns out to be operator error):
   ```sh
   pg_dumpall --globals-only --host=$PGHOST > /tmp/preserve-globals.sql
   pg_dump --format=custom --host=$PGHOST --dbname=onsecboad > /tmp/preserve-pre-restore.dump
   ```

## Restore procedure

Source `/etc/onsec/backup.env` first so all env vars are set.

```sh
source /etc/onsec/backup.env
bash infra/scripts/pg_restore.sh latest
```

Or restore a specific backup:
```sh
bash infra/scripts/pg_restore.sh postgres/onsecboad-20260429T020000Z.dump.enc
```

Verify post-restore:

```sh
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -c "SELECT COUNT(*) FROM \"Tenant\";"
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -c "SELECT MAX(\"createdAt\") FROM \"AuditLog\";"
```

The latest `AuditLog.createdAt` tells you how far back the restore took you. If the gap is too wide for the firm's tolerance, escalate.

## Post-restore

1. **Run pending migrations** (the dump may pre-date a recent migration):
   ```sh
   pnpm --filter @onsecboad/db exec prisma migrate deploy
   ```
2. **Bring the API back up**:
   ```sh
   docker compose -f infra/docker/compose.yml up -d api
   ```
3. **Smoke test** the live URL:
   ```sh
   curl -fsS https://api.onsective.cloud/api/health
   curl -fsS https://api.onsective.cloud/api/health/full | jq
   ```
4. **Notify firms** via email + status page:
   - Use the breach.md template if any client data was unrecoverable.
   - Otherwise: a brief "scheduled maintenance complete" notification.
5. **Post-incident review** within 72h. Capture in `infra/runbooks/incidents/YYYY-MM-DD.md`:
   - What was lost between backup time and incident time?
   - How can RPO be tightened?
   - Was the runbook clear / accurate / executable?

## Validation checklist (drill or real)

- [ ] Latest `Tenant` row matches expected ID
- [ ] Latest `AuditLog` row timestamp known
- [ ] `User` count > 0
- [ ] `Case` count plausibly close to pre-incident
- [ ] `pnpm --filter @onsecboad/db exec prisma migrate status` is clean
- [ ] `/api/health/full` reports all components OK
- [ ] One sample sign-in succeeds end-to-end
- [ ] R2 references on `DocumentUpload` rows still resolve (signed URL test)

## Known gotchas

- **`ALTER TABLE` migrations applied between dump time and now** must be re-applied via `prisma migrate deploy` — the dump only carries the schema as-of dump time.
- **`pg_dumpall --globals`** captures roles/tablespaces. We don't restore those by default — the prod role layer is provisioned by Hostinger / CloudPanel. If a fresh box is involved, run the role provision script first.
- **R2 documents are not affected** by a Postgres restore — they live in a separate bucket with their own retention policy. If both went down at once, see `failover.md`.
