# Incident runbook

> The on-call playbook when something is broken in production.

## Severity

| Sev | Definition | Response |
|---|---|---|
| **SEV-1** | Production unavailable for >1 firm, OR data integrity at risk | Page on-call, status page incident, hourly comms |
| **SEV-2** | Degraded for >1 firm, no data risk | Acknowledge in 1h, status page advisory |
| **SEV-3** | Single firm / single feature degraded | Acknowledge in 4h, normal triage |
| **SEV-4** | Cosmetic / advisory | Logged in tracker; no SLA |

## On-call rotation

For Phase 0 / pre-revenue, on-call is a single person (Rishabh). Build a real rotation when the second hire joins.

Single contact: `+1 (XXX) XXX-XXXX` SMS or `oncall@onsective.com`.

## Response loop (SEV-1 / SEV-2)

```
1. ACKNOWLEDGE     within 5 min
2. ASSESS          within 15 min — what's broken, what's the blast radius
3. STABILISE       contain the bleed; rollback before fix-forward when in doubt
4. RESTORE         bring service back; verify externally
5. COMMUNICATE     status page + firm-admin email at every step
6. POSTMORTEM      within 72h, regardless of severity
```

## Triage commands

```sh
# Live tail logs
ssh onsec@onsective.cloud 'docker compose -f /opt/onsec/infra/docker/compose.yml logs -f --tail=200 api web'

# Health check
curl -fsS https://api.onsective.cloud/api/health/full | jq

# DB connectivity
ssh onsec@onsective.cloud 'docker compose -f /opt/onsec/infra/docker/compose.yml exec -T postgres pg_isready'

# Redis
ssh onsec@onsective.cloud 'docker compose -f /opt/onsec/infra/docker/compose.yml exec -T redis redis-cli ping'
```

## Stabilise — common patterns

- **Bad deploy**: `cd /opt/onsec && git checkout <previous-commit> && docker compose up -d --build` — fix-forward only after the bleed stops.
- **Stripe webhook failures**: events stay in Stripe's retry queue for 72h. Don't panic; investigate the failure, fix, and they'll re-deliver.
- **Twilio webhook failures**: same retry safety net (24h). Add the failed event to a `WebhookEvent` row manually if the storm is large.
- **Postgres slowness**: check `pg_stat_activity` for long queries; identify with the locked-on `query` field; cancel non-critical ones.
- **Redis OOM**: rare for our workload (pub/sub + locks + cache). Bounce the container; investigate after.
- **R2 throttling**: backoff at the call site; CloudFlare R2 is generous.

## Comms

For SEV-1/2: post a status page incident immediately, even with thin information ("Investigating reports of delayed call assignments"). Update every 30 minutes during active investigation, hourly during stable state, on resolution.

Email to firm admins is sent from the platform tenant's verified `donotreply@onsective.com`. Use the templates below.

### Initial incident notice (SEV-1)
> Subject: [OnsecBoad] Service issue — investigating
>
> We're investigating a service issue affecting one or more components.
> No action is required from you. We'll send an update within 30 minutes.
>
> Status updates: https://onsective.cloud/status

### Resolution notice
> Subject: [OnsecBoad] Service restored
>
> Service was restored at HH:MM ET. The issue affected [scope]. No firm
> data was lost. Detailed post-incident review will be available within
> 72 hours on the status page.

## When data may have been lost

Use `breach.md` for the PIPEDA notification protocol. Lost data ≠ breach (loss vs. exposure are different obligations) but a careless restore can become both — handle the comms carefully.
