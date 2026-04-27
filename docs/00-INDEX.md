# OnsecBoad — Master Documentation Index

**Product:** OnsecBoad (AI Immigration + CRM SaaS for Canadian law firms)
**Vendor:** Onsective Inc. (Founder: Rishabh)
**Status:** Pre-implementation — docs are the source of truth until code exists.

> If you closed your terminal and came back: read this file, then jump to whichever phase says `STATUS: in-progress` in the tracker below.

---

## How to read these docs

1. **Foundational docs** (read once, refer back):
   - [`01-architecture.md`](01-architecture.md) — stack, monorepo layout, multi-tenancy, auth flow, deployment
   - [`02-data-model.md`](02-data-model.md) — full Postgres schema, relationships, indexes
   - [`03-design-system.md`](03-design-system.md) — 6 themes, typography, components, dropdown rules, responsive
   - [`04-security-and-compliance.md`](04-security-and-compliance.md) — PIPEDA, OWASP, secrets, backups
   - [`05-conventions.md`](05-conventions.md) — code style, naming, branch/PR/commit rules

2. **Phase docs** (one per delivery slice — read in order, build in order):
   - [`phase-00-foundation.md`](phase-00-foundation.md) — monorepo + auth + tenancy + theme engine
   - [`phase-01-tenant-billing.md`](phase-01-tenant-billing.md) — Onsective creates law firms; Stripe per-seat
   - [`phase-02-roles-branches-users.md`](phase-02-roles-branches-users.md) — 9 roles, branch CRUD, user invites
   - [`phase-03-crm-twilio.md`](phase-03-crm-twilio.md) — leads, telecaller CRM, Twilio voice + recording
   - [`phase-04-intake-appointments.md`](phase-04-intake-appointments.md) — intake form builder, calendar, paid consults
   - [`phase-05-case-mgmt-esign.md`](phase-05-case-mgmt-esign.md) — case workflow, in-house e-sign, retainer
   - [`phase-06-documents-filing.md`](phase-06-documents-filing.md) — doc templates, collection links, IRCC fields
   - [`phase-07-client-portal-billing.md`](phase-07-client-portal-billing.md) — client portal, installments, fee gate
   - [`phase-08-ai-layer.md`](phase-08-ai-layer.md) — AI form-filling, classifier, agent
   - [`phase-09-mobile-tv.md`](phase-09-mobile-tv.md) — Expo apps (staff, client, lobby TV)
   - [`phase-10-hardening.md`](phase-10-hardening.md) — pen test, backups, DR, PIPEDA audit

---

## Phase status tracker

Update the STATUS column as you ship. Marking a phase `done` means: code merged, deployed to staging, acceptance criteria in the phase doc are all green.

| # | Phase | Status | Started | Finished | Notes |
|---|-------|--------|---------|----------|-------|
| 0 | Foundation | not-started | — | — | Stack confirm needed |
| 1 | Tenant + Billing | not-started | — | — | Stripe account required |
| 2 | Roles/Branches/Users | not-started | — | — | — |
| 3 | CRM + Twilio | not-started | — | — | Twilio account required |
| 4 | Intake + Appointments | not-started | — | — | — |
| 5 | Case Mgmt + E-sign | not-started | — | — | — |
| 6 | Documents + Filing | not-started | — | — | R2 bucket required |
| 7 | Client Portal + Billing | not-started | — | — | — |
| 8 | AI Layer | not-started | — | — | Anthropic API key required |
| 9 | Mobile + TV | not-started | — | — | Expo + Apple/Google accounts |
| 10 | Hardening | not-started | — | — | Pen-test vendor |

---

## How each phase doc is structured (so you can scan)

```
# Phase N — <Name>
1. Goal & "Done" definition
2. Routes (frontend URLs)
3. API surface (tRPC procedures + REST endpoints)
4. Database changes (new tables/columns)
5. Background jobs
6. UI Wireframes (ASCII) with dropdown/menu positions marked
7. CRUD permission matrix (Role × Action)
8. Debug / observability hooks
9. Performance budget
10. Acceptance criteria checklist
11. Resume checkpoint (files that should exist after this phase)
```

---

## Resume protocol

If you sat down with no memory of what's done:

1. `git log --oneline | head -20` — see last commits
2. Open this file, look at status tracker
3. Find first phase with status `in-progress` or `not-started`
4. Open that phase doc → jump to "Resume checkpoint" section at the bottom
5. Run `pnpm test` and `pnpm typecheck` to confirm baseline is green
6. Continue from the first unchecked acceptance criterion

---

## Document conventions

- All wireframes are **ASCII art** — they render in any editor, survive copy/paste, never go stale because of a Figma rename.
- All API endpoints are written as `verb /path` for REST or `router.procedure` for tRPC.
- All page routes use Next.js App Router syntax: `/app/(group)/path/page.tsx`.
- Dropdowns are annotated as `[▼ Label]` in wireframes with a comment about position and contents.
- "**MUST**" / "**SHOULD**" / "**MAY**" follow RFC 2119.

---

## Open decisions (resolve before Phase 0 starts)

- [ ] Confirm stack (Next.js + tRPC + Postgres + Prisma) — see `01-architecture.md`
- [ ] Confirm payment gateway (Stripe assumed; Razorpay/Paddle alt for India billing if needed)
- [ ] Confirm e-sign approach (in-house — see Phase 5; legal review of Canadian admissibility)
- [ ] Confirm storage region (Cloudflare R2 — choose region for PIPEDA: prefer Canada/US; document in 04-security)
- [ ] Confirm domain (e.g., `app.onsecboad.com`, `*.tenant.onsecboad.com` for per-tenant subdomains)
