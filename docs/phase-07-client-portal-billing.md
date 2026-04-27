# Phase 7 — Client Portal, Invoicing & Fee Gate

> **Goal:** Clients have their own portal (separate auth) to track case status, view documents, pay invoices in installments. Submission to IRCC is hard-gated behind a zero balance.
>
> **Done when:** A client receives a portal invite via email, signs in with magic link + email OTP, sees their case status and a $5,000 invoice with a $1,500 deposit paid; they pay an installment via Stripe; firm tries to submit case while balance > 0 and is blocked; client pays final balance; firm submits successfully.

## Routes

| URL | Who | What |
|---|---|---|
| `/portal/sign-in` | client | email + magic link OR password |
| `/portal/2fa` | client | email OTP (TOTP optional) |
| `/portal` | client | overview |
| `/portal/case/[id]` | client | case timeline + status |
| `/portal/documents` | client | upload/view |
| `/portal/payments` | client | invoices + payment history |
| `/portal/messages` | client | secure messaging w/ firm |
| `/portal/profile` | client | personal info + 2FA |
| `/f/cases/[id]/billing` | filer/CM/admin | invoice + payments |
| `/f/invoices` | admin/CM | tenant-wide invoice list |
| `/f/invoices/new` | filer/CM/admin | create |

## API surface

### Portal (separate router; client auth)

```
portalAuth.requestMagic({email})            → ok
portalAuth.verifyMagic({token})             → {ticket}
portalAuth.signInPassword({email, pw})      → {ticket}
portalAuth.verify2FA({ticket, code})        → {accessToken}
portalAuth.signOut()                        → ok

portal.me()                                 → {client, firm, branding}
portal.cases.list()                         → CaseSummary[]
portal.cases.get({id})                      → public-safe payload
portal.documents.list()                     → Document[]
portal.documents.uploadPresign(...)         → presigned
portal.payments.invoices()                  → Invoice[]
portal.payments.intent({invoiceId, cents})  → {clientSecret}
portal.payments.history()                   → Payment[]
portal.messages.thread()                    → Message[]
portal.messages.send({body, attachments?})  → Message
portal.profile.update(...)                  → ok
portal.profile.twofa.enroll()               → {qr, secret}
portal.profile.twofa.confirm({code})        → ok
```

### Firm-side

```
invoice.list({page, status, clientId, caseId}) → paginated
invoice.get({id})                              → Invoice + items + payments
invoice.create(input)                          → Invoice
invoice.update({id, items?, dueDate?})         → Invoice
invoice.send({id})                             → Invoice (status=SENT)
invoice.markPaid({id, payment})                → Invoice
invoice.recordPayment({invoiceId, payment})    → Payment
invoice.refund({paymentId, cents, reason})     → ok
invoice.void({id, reason})                     → Invoice
invoice.pdf({id})                              → presigned URL

case.canSubmit({id})                           → {ok, reasons[]}
case.recordSubmission(...) /* P6 */            → enforces canSubmit on server
```

### REST (public)

- `POST /api/v1/webhooks/stripe-portal` — `payment_intent.succeeded` for client invoice payments. Verify signature.

## Database changes

- `Invoice`, `InvoiceItem`, `Payment`, `ClientPortalAccount` per `02-data-model.md`.
- New `Message` for secure portal threads:
  ```prisma
  model Message {
    id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
    tenantId    String   @db.Uuid
    caseId      String?  @db.Uuid
    clientId    String   @db.Uuid
    sender      MessageSender
    senderUserId String? @db.Uuid
    body        String
    attachments Json?
    readByClient DateTime?
    readByStaff  DateTime?
    createdAt   DateTime @default(now())
    @@index([tenantId, clientId, createdAt])
  }
  enum MessageSender { CLIENT STAFF SYSTEM }
  ```

## Background jobs

| Job | Purpose |
|---|---|
| `invoice-pdf` | Render invoice PDF (with firm branding) → R2 |
| `invoice-due-reminder` | T-3d, T-1d, T+1d reminders |
| `payment-reconcile` | Cross-check Stripe ledger nightly |
| `portal-account-provision` | When case enters `PENDING_DOCUMENTS` and no portal account: create + email invite |
| `magic-link-expire` | Expire 15-min unused tokens |

## Wireframes

### Client portal sign-in `/portal/sign-in`

Themed per tenant branding. Logo + "Sign in to your <Firm Name> portal".
Two paths: [ Email me a sign-in link ] or [ I have a password ]. Magic link preferred.

### Portal overview `/portal`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Firm logo]   Welcome, John                          [▼ EN]  [Sign out]  │
├──────────────────────────────────────────────────────────────────────────┤
│ Overview · Documents · Payments · Messages · Profile                     │
├──────────────────────────────────────────────────────────────────────────┤
│  Your active case                                                        │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Work Permit · WP-2026-00123                                        │  │
│  │ Status: ⓘ Pending Documents                  [ Upload documents → ]│  │
│  │ Filed on: —      Decision: pending                                 │  │
│  │                                                                    │  │
│  │ Progress                                                           │  │
│  │ ●━━━●━━━○━━━○━━━○                                                   │  │
│  │ Retainer  Documents  Preparation  Submission  Decision             │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Outstanding balance:  CAD $3,500   [ Pay an installment → ]              │
└──────────────────────────────────────────────────────────────────────────┘
```

### Portal payments `/portal/payments`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Payments                                                                 │
├──────────────────────────────────────────────────────────────────────────┤
│ Invoice INV-2026-000123                                                  │
│   Total       CAD $5,000                                                 │
│   Paid        CAD $1,500   (2 payments)                                  │
│   Balance     CAD $3,500                                                 │
│   Due date    2026-05-30                                                 │
│                                                                          │
│   Pay an installment                                                     │
│   Amount  [ $ 1,000.00 ]   [ Pay now → ]                                  │
│                                                                          │
│   Suggested: $1,750 (50%) · $3,500 (full balance)                        │
│                                                                          │
│  Payment history                                                         │
│  2026-04-26  $1,000  Visa •••• 4242  ✓  [⤓ receipt]                       │
│  2026-04-25  $500    Visa •••• 4242  ✓  [⤓ receipt]                       │
└──────────────────────────────────────────────────────────────────────────┘
```

Pay flow uses Stripe PaymentElement (PCI-safe). On success, webhook updates invoice + portal refreshes via WebSocket.

### Firm-side case billing `/f/cases/[id]/billing`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Billing                                                                  │
├──────────────────────────────────────────────────────────────────────────┤
│ Invoice INV-2026-000123                                  [▼ Status: Sent]│
│ Due 2026-05-30                                                            │
│                                                                          │
│ Items                                                                    │
│ Description                  Qty   Unit       Total                       │
│ Government fees              1     $155.00    $155.00                    │
│ Professional fees            1     $4,845.00  $4,845.00                  │
│                                              ────────                    │
│                                       Total  $5,000.00                    │
│                                       Paid   $1,500.00                    │
│                                       Bal    $3,500.00                    │
│                                                                          │
│ [ + Add item ]   [ Edit ]   [ Send to client ]   [ Record cash payment ] │
│                                                                          │
│ Submission gate                                                          │
│  ⛔ Cannot submit to IRCC: outstanding balance of $3,500.                 │
│     File submission will be enabled when balance reaches $0.             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Record cash payment modal

```
┌────────────────────────────────────────────────┐
│ Record payment                                 │
├────────────────────────────────────────────────┤
│ Method     [▼ Cash]                            │
│ Amount     [ $ 1,750.00 ]                      │
│ Date       [📅 2026-04-26]                     │
│ Reference  [_______________________]           │
│ Notes      [_______________________]           │
│                                                │
│            [Cancel]  [Save payment]            │
└────────────────────────────────────────────────┘
```

## CRUD matrix

| Entity | Action | Onsective | FirmAdmin | BranchMgr | Filer/CM | Lawyer | Client (portal) |
|---|---|---|---|---|---|---|---|
| Invoice | C | ✓ | ✓ | ✓ | ✓ | — | — |
| Invoice | R | ✓ | tenant | branch | own case | own case | own |
| Invoice | U items / send | ✓ | ✓ | ✓ | own case | — | — |
| Invoice | refund/void | ✓ | ✓ | — | — | — | — |
| Payment | C (record) | ✓ | ✓ | ✓ | own case | — | — |
| Payment | C (Stripe) | webhook | webhook | — | — | — | ✓ (client-initiated) |
| ClientPortalAccount | C | auto | ✓ | ✓ | ✓ | — | — |
| ClientPortalAccount | reset/disable | ✓ | ✓ | ✓ | — | — | — |
| Message | C/R | tenant | tenant | branch | own case | own case | own |

## Debug / observability

- Stripe webhook idempotency: store `event.id` UNIQUE.
- Reconciliation: nightly diff between Stripe payments and local `Payment` rows; alert on drift.
- Submission attempts blocked by gate are logged with `reason=balance_due` for analytics ("how often does the gate fire? for which firms?").
- Portal sign-in: capture failure types (expired magic, invalid email) for support.
- Magic-link reuse attempts logged + counter.

## Performance budget

- Portal overview TTFB < 300ms; first paint < 1.2s.
- PaymentIntent creation (server) < 200ms.
- Invoice PDF render < 3s (cached after first render).

## Acceptance criteria

- [ ] When case enters `PENDING_DOCUMENTS`, portal account auto-provisioned and invite email sent
- [ ] Magic link works once; second use returns "expired"
- [ ] OTP 2FA mandatory for client portal too
- [ ] Client can pay an installment via Stripe; payment reflected in portal + firm view within 5s of webhook
- [ ] Cash payment recorded by staff updates balance; client portal shows it
- [ ] Submission blocked when balance > 0 — verified at API level, not just UI; integration test attempts to bypass UI
- [ ] PDF invoice generated, branded with theme colors + logo, downloadable
- [ ] Refund flow works; portal reflects new balance
- [ ] Messaging: client and staff can exchange messages with attachments; unread counters correct
- [ ] Reconciliation cron runs and reports 0 drift after a synthetic series of payments + refunds

## Resume checkpoint

```
apps/web/src/app/portal/...                    ← separate auth + theme inherits tenant
apps/web/src/app/(firm)/cases/[id]/billing/...
apps/web/src/app/(firm)/invoices/...
packages/auth/portalAuth.ts
packages/pdf/invoice.ts
packages/jobs/invoicePdf.ts, invoiceDueReminder.ts, paymentReconcile.ts, portalProvision.ts
packages/db/schema.prisma                       ← Message added
```

Sit-back-down test: in Stripe test mode, pay an installment from the portal. Within 5s the firm-side billing screen should reflect the new payment. Then attempt to mark the case Submitted while balance > 0 — must be blocked with a clear error. Pay the rest, retry — must succeed. If the gate doesn't fire → check `case.canSubmit` server-side enforcement.
