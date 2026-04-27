# Phase 1 — Tenant Lifecycle & Billing

> **Goal:** Onsective can sell to a law firm end-to-end through the UI: capture card → choose package → provision tenant → email setup link → Firm Admin completes branding → ready to use. Per-seat billing wired to Stripe.
>
> **Done when:** From `/p/firms`, a platform manager can click "+ New Firm", fill a 4-step wizard (firm info → package → card → review), submit, and 60 seconds later the new Firm Admin receives an invite email and successfully signs in to a themed dashboard. Their first invoice line shows `1 seat`. Adding/removing users in P2 will move the seat counter and the next invoice.

## Packages (sold by Onsective)

| Code | Name | Per-seat / month (CAD) | Limits |
|---|---|---|---|
| `STARTER` | Starter | $39 | 1 branch, 5 users, 200 leads/mo, 100 cases/yr, no AI |
| `GROWTH` | Growth | $79 | 5 branches, 50 users, 5,000 leads/mo, unlimited cases, AI form-fill basic |
| `SCALE` | Scale | $129 | unlimited branches/users/leads/cases, AI agent, white-label, SLA |

## Routes

| URL | Who | What |
|---|---|---|
| `/p/firms` | platform mgr | list with search/filter; status badges |
| `/p/firms/new` | platform mgr | 4-step wizard |
| `/p/firms/[id]` | platform mgr | firm detail: profile, subscription, users, audit, support actions |
| `/p/firms/[id]/billing` | platform mgr | invoices, payment methods, plan changes |
| `/p/billing/plans` | platform mgr | edit plan tiers, prices |
| `/f/setup` | newly invited Firm Admin | first-login wizard (branding + first branch) |
| `/f/settings/billing` | Firm Admin | own subscription, payment method, invoices, usage |

## API surface

### tRPC

```
platform.tenant.list({page, q, status})       → paginated
platform.tenant.get({id})                     → Tenant + subscription detail
platform.tenant.create(input)                 → {tenantId, setupUrl}
   input: { legalName, displayName, slug, country, contactName, contactEmail,
            packageTier, paymentMethodId (Stripe PM), couponCode? }
platform.tenant.suspend({id, reason})         → ok
platform.tenant.resume({id})                  → ok
platform.tenant.cancel({id, immediate})       → ok
platform.tenant.changePlan({id, tier})        → ok
platform.tenant.usage({id, period})           → {seats, leads, cases, storage}

platform.billing.invoices({tenantId, page})   → paginated
platform.billing.invoiceUrl({id})             → presigned PDF URL
platform.billing.refund({invoiceId, cents})   → ok

billing.subscription.get()                    → own subscription
billing.subscription.updatePaymentMethod()    → SetupIntent client secret
billing.invoices.list({page})                 → paginated
billing.usage.current()                       → live usage snapshot

setup.complete(input)                         → ok
   input: { branding, firstBranch: {name, address, phone}, ... }
```

### REST

- `POST /api/v1/webhooks/stripe` — `customer.subscription.*`, `invoice.*`, `payment_intent.*`. Verify `Stripe-Signature`. Idempotent via `event.id`.

## Database changes

- Use existing `Tenant`, add: `stripeCustomerId`, `stripeSubscriptionId`, `trialEndsAt`, `setupCompletedAt`, `setupTokenHash` (for first-login link)
- New: `SubscriptionInvoice` (per `02-data-model.md`)
- New: `Plan` table (so prices are editable via UI rather than hard-coded)
  ```prisma
  model Plan {
    id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
    code          String   @unique     // STARTER|GROWTH|SCALE
    name          String
    pricePerSeatCents BigInt
    currency      String   @default("CAD")
    stripePriceId String   @unique
    limits        Json
    isActive      Boolean  @default(true)
  }
  ```

## Background jobs

| Job | Trigger |
|---|---|
| `tenant-provision` | After `platform.tenant.create` returns: create Stripe customer + subscription, create tenant DB row, create FirmAdmin user with setup token, send setup email |
| `seat-sync` | On user create/disable in P2: call Stripe API to update subscription quantity |
| `invoice-pdf-cache` | When Stripe `invoice.finalized`: download PDF, store in R2, save URL in `SubscriptionInvoice` |
| `usage-snapshot` | Cron daily: write per-tenant usage row for analytics |

## UI Wireframes

### `/p/firms` — list

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Law Firms                                                  [+ New Firm]  │  ← opens wizard
├──────────────────────────────────────────────────────────────────────────┤
│ [🔍 search]   Status [▼ All]   Plan [▼ All]   Sort [▼ Created ↓]        │  ← dropdowns DOWN-START
├──────────────────────────────────────────────────────────────────────────┤
│ Name              Plan      Status     Seats   MRR (CAD)   Created  ⋯    │
│ Acme Immigration  GROWTH   ● Active     12    $948        1d       [⋯]  │
│ Maple Legal       STARTER  ● Active      3    $117        4d       [⋯]  │
│ ...                                                                      │
│                                          ◀  1 2 3 ... 10  ▶              │
└──────────────────────────────────────────────────────────────────────────┘
```

Row [⋯] (DOWN-END): Open · Suspend · Resume · Change plan · Cancel · Audit log

### `/p/firms/new` — 4-step wizard

```
Step 1 of 4: Firm Information
┌────────────────────────────────────────────────────────────┐
│ Legal name *           [_________________________________] │
│ Display name *         [_________________________________] │
│ Slug (URL) *           acme-immigration  .onsecboad.com    │
│ Country *              [▼ Canada                        ]  │
│ Primary contact name * [_________________________________] │
│ Contact email *        [_________________________________] │
│ Contact phone          [+1 ___ ___ ____]                   │
│                                                            │
│                        [← Back]  [Next: Choose plan →]    │
└────────────────────────────────────────────────────────────┘

Step 2 of 4: Choose plan
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   STARTER    │  │   GROWTH     │  │   SCALE      │
│   $39/seat   │  │   $79/seat   │  │   $129/seat  │
│              │  │              │  │              │
│ • 1 branch   │  │ • 5 branches │  │ • Unlimited  │
│ • 5 users    │  │ • 50 users   │  │ • AI Agent   │
│ • 200 leads  │  │ • 5K leads   │  │ • SLA        │
│   [ Select ] │  │   [ Select ] │  │   [ Select ] │
└──────────────┘  └──────────────┘  └──────────────┘
                                  [← Back]   [Next →]

Step 3 of 4: Payment method
┌────────────────────────────────────────────────────────────┐
│ Card number       [ Stripe Elements                      ] │
│ Expiry / CVC      [ Stripe Elements                      ] │
│ Cardholder name   [_________________________________]     │
│ Billing address   [_________________________________]     │
│ Coupon code       [____________]   [ Apply ]               │
│                                                            │
│ ☐ Start with 14-day trial (no charge until trial ends)    │
│                                                            │
│                        [← Back]   [Next: Review →]        │
└────────────────────────────────────────────────────────────┘

Step 4 of 4: Review & Provision
┌────────────────────────────────────────────────────────────┐
│ Summary                                                    │
│   Firm: Acme Immigration                                   │
│   Slug: acme-immigration.onsecboad.com                     │
│   Plan: GROWTH @ $79/seat                                  │
│   Initial seats: 1 (Firm Admin)                            │
│   Trial: 14 days                                           │
│   Card: •••• 4242                                          │
│                                                            │
│ Setup email will be sent to: contact@acme.com              │
│                                                            │
│                  [← Back]   [Provision firm →]             │
└────────────────────────────────────────────────────────────┘
```

After provision: success page with magic-link copy ("Setup email sent. Resend? Copy link?") and a "View firm" button → `/p/firms/[id]`.

### `/f/setup` — first-login wizard for Firm Admin

```
Step 1: Welcome — confirm contact details
Step 2: Branding — pick from 6 themes / custom + upload logo
Step 3: First branch — name, address, phone, branch manager (you OK to be admin+manager? toggle)
Step 4: Invite teammates (optional skip — completes in P2)
Step 5: Done → land on /f/dashboard
```

### `/p/firms/[id]` — firm detail

Tabs: Overview · Subscription · Users · Activity · Support

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ← Back to firms                                                            │
│ Acme Immigration                       [● Active]    [▼ Actions]           │  ← Actions DOWN-END
├────────────────────────────────────────────────────────────────────────────┤
│ [Overview] [Subscription] [Users] [Activity] [Support]                     │
├────────────────────────────────────────────────────────────────────────────┤
│  Plan         GROWTH               MRR        $948                         │
│  Seats        12 / 50              Status     Active                       │
│  Created      2026-04-25           Trial ends 2026-05-09                  │
│  Slug         acme-immigration                                             │
│                                                                            │
│  Recent activity                                                           │
│  • 2h ago — Sara L. (FILER) signed in                                     │
│  • 4h ago — 3 leads ingested from Meta                                    │
│  • 1d ago — Plan changed STARTER → GROWTH                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

[▼ Actions] menu: Suspend · Resume · Change plan · Send password reset to admin · Cancel subscription · Force re-send setup email

### `/f/settings/billing` — Firm Admin

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Settings › Billing                                                         │
├────────────────────────────────────────────────────────────────────────────┤
│ Current plan                                                               │
│   GROWTH    12 seats × $79 = $948/mo    Next bill: May 25                  │
│                                                              [ Change plan ]
│                                                                            │
│ Payment method                                                             │
│   Visa •••• 4242 exp 09/28                            [ Update card ]      │
│                                                                            │
│ Invoices                                                                   │
│   2026-05-01  $948.00   PAID    [⤓ PDF]                                    │
│   2026-04-01  $158.00   PAID    [⤓ PDF]                                    │
│                                                                            │
│ Usage this period                                                          │
│   Leads ingested: 1,243 / 5,000                                            │
│   Cases active:   42 / unlimited                                           │
│   Storage:        2.3 GB                                                   │
└────────────────────────────────────────────────────────────────────────────┘
```

## CRUD matrix

| Entity | Action | Onsective | FirmAdmin | BranchMgr | others |
|---|---|---|---|---|---|
| Tenant | C/U status/D | ✓ | — | — | — |
| Tenant.branding | U | ✓ | ✓ | — | — |
| Plan | C/R/U/D | ✓ | — | — | — |
| Subscription | R own | ✓ | ✓ (own) | — | — |
| Subscription.changePlan | U | ✓ | ✓ (own, with confirm) | — | — |
| PaymentMethod | U | ✓ | ✓ | — | — |
| SubscriptionInvoice | R | ✓ | ✓ (own) | — | — |
| SubscriptionInvoice.refund | U | ✓ | — | — | — |

## Debug / observability hooks

- Stripe webhook handler logs `event.id`, `event.type`, `tenant.id`, `outcome`. Idempotency table prevents replay.
- `tenant-provision` job emits checkpoints: `stripe.customer.created`, `stripe.subscription.created`, `tenant.row.created`, `firm.admin.created`, `setup.email.sent`. Failure mid-way leaves tenant `PROVISIONING` for inspection.
- Provisioning UI shows live progress (SSE from job) so platform manager sees what failed.
- Daily reconciliation cron: compare local seat count to Stripe subscription quantity; alert on mismatch.

## Performance budget

- Tenant create end-to-end (button click → setup email sent) p95 < 8s
- Stripe webhook processing p95 < 500ms
- Invoice list page TTFB < 300ms

## Acceptance criteria

- [ ] Stripe test keys wired; can run wizard end-to-end with `tok_visa`
- [ ] Provisioning failure mid-job is observable + retryable from `/p/firms/[id]`
- [ ] Trial countdown visible to Firm Admin; charge happens at trial end
- [ ] Plan downgrade scheduled at period end; upgrade applies immediately with proration
- [ ] Suspending tenant → users see "Account suspended, contact your firm admin" on next request; payment-method update flow still accessible
- [ ] Card update via SetupIntent works without exposing card data to our server
- [ ] Webhook signature failures rejected; replay prevented
- [ ] Audit log shows tenant creation, plan changes, suspensions
- [ ] PDF invoices stored in R2; viewable via signed URL with 1h expiry
- [ ] E2E test: Provision → Firm Admin sets up → seat count is 1 → matches Stripe subscription quantity

## Resume checkpoint

After this phase, the codebase has:
- `apps/web/src/app/(platform)/firms/...` — list, wizard, detail
- `apps/web/src/app/(firm)/setup/...` — first-login wizard
- `apps/web/src/app/(firm)/settings/billing/...`
- `packages/integrations/stripe/` — client + webhook handlers + idempotency table
- `packages/jobs/tenantProvision.ts`, `seatSync.ts`
- Updated `Plan`, `Tenant` schema migrations

Sit-back-down test: in Stripe test mode, create a fresh tenant via the wizard. Within ~10 seconds your inbox should have a setup email. Click it → land on `/f/setup` → finish wizard → see themed dashboard. If yes → Phase 1 done.
