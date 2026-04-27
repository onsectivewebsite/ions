# Phase 10 — Hardening (Compliance, DR, Pen-test, Performance)

> **Goal:** OnsecBoad is production-grade, audited, and operable. PIPEDA / CASL compliance proven. Backups restore-tested. Pen-test passed with zero high/critical. Load tested at 5× current usage. Documentation handed off.
>
> **Done when:** Pen-test report shows no high/critical findings; restore drill recovered the system in <60 min from cold; PIPEDA checklist 100% complete with evidence; load test sustains 100 concurrent firms × 10 users × 10 RPS for 30 min within latency SLOs.

## Workstreams

### A. PIPEDA & CASL evidence pack

- Privacy policy + terms reviewed by legal counsel; published.
- Data Processing Agreement (DPA) template ready for firms requesting one.
- Sub-processor list current (Cloudflare, Hostinger, Stripe, Twilio, Resend, Anthropic).
- Right-to-access export tested for one client end-to-end (zip with all data they touched).
- Right-to-deletion: soft-delete + 30-day grace + hard-delete script tested. Legal hold flag stops deletion.
- Breach runbook in `infra/runbooks/breach.md` includes 72-hour notification protocol.
- CASL: every marketing template has unsubscribe + sender ID; suppression list global per tenant; DNC/DNE flags honored across all sends; audit log of consent capture.

### B. Backup & disaster recovery

- Postgres: nightly `pg_basebackup` + WAL archiving to encrypted R2 bucket in a different region from the primary.
- R2 documents: versioning enabled with 30-day delete protection.
- Restore drill (run quarterly): provision fresh VPS, restore latest base + WAL, verify data integrity (compare row counts + a few checksums), measure time. RTO target ≤ 60 min, RPO ≤ 5 min.
- Runbooks: `infra/runbooks/restore.md`, `failover.md`, `incident.md`.
- Status page (`status.onsecboad.com`) — public uptime + incident history.

### C. Pen-test

- Engage external vendor; provide test tenant with two roles, scope = the live SaaS (web + portal + API + mobile if shipped).
- Threat model & attack surface document handed over.
- Findings tracked in GitHub Issues with labels `security/critical|high|medium|low`.
- All high/critical fixed and re-tested before sign-off.
- Public summary published (one-pager) for sales conversations.

### D. Performance & load

- k6 scripts under `infra/load/`:
  - `login-burst.js` — 200 concurrent logins
  - `lead-ingest.js` — 50 RPS sustained per tenant
  - `case-board.js` — 10 RPS per tenant, 50 tenants
  - `client-portal.js` — 100 concurrent portal users
- Run on staging that mirrors prod sizing; collect Grafana dashboards.
- Tune slow queries (EXPLAIN), indexes, connection pool sizing.
- Acceptance: API p95 < 250ms, p99 < 700ms; error rate < 0.1%.

### E. Operational tooling

- `bin/onsec` CLI for ops:
  - `tenant:create|suspend|delete`
  - `tenant:export <id>` — full data dump (PIPEDA support)
  - `user:resetpw <id>`
  - `db:restore <backup>`
  - `flag:set <key> <value> [--tenant <id>]`
- Audit log dashboard with full-text search.
- Feature flags via `flagsmith` or env-driven simple system; per-tenant overrides for AI features etc.
- On-call rota + Pager (PagerDuty/Opsgenie); alert routing for: API 5xx > 1% / 5min, queue lag > 1000, payment webhook 401s, AI cost spike, R2 errors > 0.5%.

### F. Accessibility audit

- VoiceOver (iOS), NVDA (Windows), JAWS pass on key flows: sign-in, intake, calendar, case detail, retainer signing, portal pay.
- Lighthouse Accessibility ≥ 95 on all major pages.
- Keyboard-only walkthrough video archived for the support team.

### G. Localization

- French (fr-CA) translations complete and reviewed by native speaker for legal terminology.
- Date/number/currency formatting verified via locale tests.
- RTL not required for Canadian launch but components must not break layout when locales added later.

### H. Sales-grade docs

- Public docs site (`docs.onsecboad.com`) with: getting-started, feature tours, role guides, integration guides (Twilio, Stripe, Meta lead ads), API reference (auto-generated from OpenAPI).
- In-app walkthroughs (intro.js style) for first-login per role.
- Help center articles backing the in-app `?` button.

## Deliverables checklist

- [ ] Pen-test report + remediation log
- [ ] DR drill report (RTO/RPO measured)
- [ ] PIPEDA evidence pack with signed-off checklist
- [ ] Load test report + Grafana snapshots
- [ ] Status page live
- [ ] Runbooks committed and reviewed (incident, breach, restore, failover, on-call)
- [ ] On-call rota in place; alert routing tested via synthetic incident
- [ ] CLI shipped + documented
- [ ] Public docs site live
- [ ] In-app walkthroughs for FirmAdmin, BranchMgr, Lawyer, Filer, Telecaller, Receptionist, Client
- [ ] Backup/restore tested by someone who didn't write the code
- [ ] Accessibility report
- [ ] French locale verified

## Acceptance criteria

- [ ] Zero high/critical pen-test findings open
- [ ] DR drill achieves RTO ≤ 60 min, RPO ≤ 5 min
- [ ] Load test passes SLOs at 5× current production
- [ ] PIPEDA checklist 100%
- [ ] All runbooks executed at least once by on-call engineer
- [ ] Status page reflects real incidents (one synthetic test incident posted and resolved)

## Resume checkpoint

```
infra/runbooks/                 ← incident, breach, restore, failover, on-call
infra/load/                     ← k6 scripts + last results
bin/onsec                       ← ops CLI
docs/legal/                     ← privacy policy, ToS, DPA template, sub-processor list
docs/customer/                  ← public docs source (Astro/Next.js docs site)
.github/CODEOWNERS              ← security paths require review by founder + senior eng
.github/SECURITY.md             ← responsible disclosure policy + contact
```

Sit-back-down test: trigger a synthetic high-severity alert (e.g., simulate API 5xx spike). Within 5 min the on-call should be paged, status page updated, and the runbook in `infra/runbooks/incident.md` should walk them through containment. If not → the gap is the launch blocker.
