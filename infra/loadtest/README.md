# Load tests (k6)

Phase 10.3. Scenarios target the docs/phase-10 spec: **100 concurrent
firms × 10 users × 10 RPS for 30 minutes within latency SLOs**.

Run against a staging environment, not prod. The scenarios assume the
demo seed has run (`pnpm db:seed`) so test users exist.

## Setup

Install [k6](https://k6.io/docs/get-started/installation/) on the host
that'll drive the load (a separate VPS, not the API host). For mac dev:

```sh
brew install k6
```

## Environment

Each scenario reads:

- `BASE_URL` — API root (e.g. `https://api.onsective.cloud`). Default
  `http://localhost:4000`.
- `WEB_URL` — Web root for portal scenarios. Default `http://localhost:3000`.
- `EMAIL` / `PASSWORD` — staff or platform-admin credentials. The seed
  ships with `admin@onsective.com` / a generated password (printed on
  first seed) and `rk9814289618@gmail.com` for the demo firm admin.
- `OTP_FIXTURE` — fixed 6-digit code; if your test env has a stub OTP
  flow set this; otherwise scenarios that need 2FA skip themselves.
- `API_KEY` — for the public lead-ingest scenario. Create one via
  `apiKey.create` in the firm-scope tRPC.

## Scenarios

```sh
# Quick smoke — 1 VU, 30s — confirms the API is reachable + healthy.
k6 run scenarios/baseline-smoke.js

# Realistic firm load — VUs ramped to ~1000 (100 firms × 10), 10 RPS
# per user, 30-minute steady state. Run only on staging.
k6 run scenarios/realistic-firm.js

# Public lead-ingest — hammers /api/v1/leads/ingest.
API_KEY=osk_xxx k6 run scenarios/public-lead-ingest.js

# Client portal — signs in as a portal user, lists cases / invoices,
# opens messages.
PORTAL_EMAIL=… PORTAL_PASSWORD=… k6 run scenarios/portal-client.js

# Long-lived SSE — opens 100 connections + holds for 30s.
k6 run scenarios/sse-stream.js
```

## What "pass" means

| Metric | Target |
|---|---|
| `http_req_duration{type:read} p(95)` | < 500ms |
| `http_req_duration{type:write} p(95)` | < 1500ms |
| `http_req_failed` | < 1% |
| `iteration_duration p(95)` | < 3s for paginated reads |

## Where these scenarios are deliberately thin

- **No write storms by default**: the realistic scenario is read-heavy
  (list + detail) plus light writes (call.start, lead.changeStatus). A
  full write storm would corrupt the seed data and need cleanup. Run
  the dedicated `public-lead-ingest` scenario for write throughput.
- **No realistic Twilio / Stripe traffic**: stub-aware integrations
  short-circuit in test envs. That's fine for measuring API throughput;
  it doesn't measure end-to-end vendor latency.
- **No SSE pub/sub propagation timing**: the SSE scenario just measures
  connection density, not event-delivery latency.

## Troubleshooting

- `auth.signIn 429`: built-in lockout (5 fails). Wait or reset.
- `auth.requestEmailOtp` returns immediately but no OTP arrives: the
  staging env's email config likely doesn't have a real SMTP. Use the
  `OTP_FIXTURE` env or stub `requestEmailOtp` for load-test runs.
- High `http_req_failed`: check `/api/health/full` first; if the DB is
  down, scenarios will all fail.
