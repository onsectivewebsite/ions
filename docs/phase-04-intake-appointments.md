# Phase 4 — Intake Forms, Appointments & Calendar

> **Goal:** Firm Admin defines intake forms and consultation pricing; clients submit (online or in-office); receptionist looks up by phone (= primary key) and books a consultation with a lawyer or consultant; calendar handles availability and Stripe collects paid consult fees.
>
> **Done when:** Admin builds a custom intake form; a public link captures a submission; receptionist enters that phone, sees prior history, books a 30-min paid consult with a lawyer; lawyer sees it on their calendar; client receives confirmation email; receptionist marks "arrived" on the day; status flows correctly.

## Routes

| URL | Who | What |
|---|---|---|
| `/i/[slug]` | public | intake form (no auth) |
| `/i/[slug]/thanks` | public | thank-you with next steps |
| `/f/clients` | staff | client directory (phone-search-first) |
| `/f/clients/lookup` | recept/staff | phone-first lookup screen (default home for receptionist) |
| `/f/clients/[id]` | staff | client 360 |
| `/f/clients/[id]/intakes` | staff | intake submission history |
| `/f/calendar` | lawyer/consultant/admin/recept | calendar |
| `/f/appointments/new` | recept/admin/mgr | book |
| `/f/appointments/[id]` | staff | detail |
| `/f/masters/intake-forms` | admin | list |
| `/f/masters/intake-forms/new` | admin | builder |
| `/f/masters/intake-forms/[id]/edit` | admin | builder |
| `/f/masters/consultation-types` | admin/mgr | pricing master |

## API surface

```
intakeForm.list()                              → IntakeForm[]
intakeForm.create(input)                       → IntakeForm
intakeForm.update({id, schema?, isActive?})    → IntakeForm
intakeForm.publicGet({slug})                   → IntakeForm (public-safe)
intakeForm.submitPublic({slug, data, captcha}) → IntakeSubmission

client.lookupByPhone({phone})                  → Client | null + summary
client.list({page, q, branchId})               → paginated
client.get({id})                               → Client + relations
client.create(input)                           → Client
client.update({id, ...})                       → Client
client.merge({fromId, toId})                   → Client

consultationType.list()                        → ConsultationType[]
consultationType.upsert(input)                 → ConsultationType
consultationType.archive({id})                 → ok

appointment.availability({staffId, dateRange}) → slot[]
appointment.create(input)                      → Appointment + paymentIntent?
   input: { clientId, staffUserId, consultationTypeId, scheduledStart, branchId, notes? }
appointment.list({range, mine, branchId})      → Appointment[]
appointment.get({id})                          → Appointment + Client + Staff
appointment.markArrived({id})                  → Appointment
appointment.cancel({id, reason})               → Appointment
appointment.reschedule({id, newStart})         → Appointment
appointment.markPaid({id, paymentMethod})      → Appointment    // for cash/etransfer
```

### REST (public)

- `GET /api/v1/intake/[slug]` — return safe schema
- `POST /api/v1/intake/[slug]/submit` — Cloudflare Turnstile token validated; rate-limited

## Database changes

- `IntakeForm`, `IntakeSubmission`, `Client`, `Appointment` (already in `02-data-model.md`).
- New `ConsultationType`:
  ```prisma
  model ConsultationType {
    id              String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
    tenantId        String  @db.Uuid
    code            String                    // "FREE_15", "PAID_30", ...
    name            String
    durationMinutes Int
    feeCents        BigInt @default(0)
    currency        String @default("CAD")
    bookableBy      String[]                   // ["LAWYER", "CONSULTANT"]
    isActive        Boolean @default(true)
    @@unique([tenantId, code])
  }
  ```
- New `StaffAvailability`:
  ```prisma
  model StaffAvailability {
    id          String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
    tenantId    String  @db.Uuid
    userId      String  @db.Uuid
    weekday     Int                            // 0-6
    startMin    Int                            // minutes from 00:00
    endMin      Int
    branchId    String?  @db.Uuid
  }
  model TimeOff {
    id          String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
    tenantId    String  @db.Uuid
    userId      String  @db.Uuid
    start       DateTime
    end         DateTime
    reason      String?
  }
  ```

## Background jobs

| Job | Purpose |
|---|---|
| `appt-reminder` | T-24h email + T-2h SMS reminders to client + staff |
| `intake-link-followup` | If client never submitted intake by appt time, alert receptionist |
| `payment-watch` | If `PaymentIntent` failed, update appointment to `unpaid` and notify staff |
| `client-merge-resolve` | When two clients merged, reassign all FK references |

## Wireframes

### Intake form builder (`/f/masters/intake-forms/new`)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Intake form                                                              │
│ Name [_______________]   Public slug [/i/__________]   ☑ Active          │
├────────────┬────────────────────────────┬────────────────────────────────┤
│ Toolbox    │  Canvas (drag fields)       │ Field properties               │
│            │                             │                                │
│ ▤ Section  │  Section: Personal Info     │ Label  [_______]              │
│ ⓣ Text     │   • Full name * [text]      │ Type   [▼ Text]               │
│ # Number   │   • Phone *   [phone]       │ Key    [_______] (auto)        │
│ 📅 Date    │   • Email     [text]        │ Required ☑                     │
│ ☑ Boolean  │   • DOB       [date]        │ Conditional show              │
│ ▼ Select   │  Section: Travel History    │   When [field] [op] [value]   │
│ ☐ Multi    │   • Visited Canada? [bool]  │                                │
│ ⤓ File     │     ↳ if true, show:         │ Validation                    │
│ ✍ Sign     │       Years visited [#]     │   Min length [__]             │
│            │   • Refusal history? [bool] │   Pattern   [_____]           │
│            │  ...                         │                                │
│            │                              │                                │
│ [+ Section]│  [+ Add field]               │                                │
└────────────┴────────────────────────────┴────────────────────────────────┘
                                                  [ Preview ]  [ Save ]
```

Public form preview opens in new tab; submit is disabled in preview mode.

### Public intake (`/i/[slug]`)

```
┌────────────────────────────────────────────────┐
│ [Firm logo]                                    │
│ Acme Immigration — Free Consultation Request   │
├────────────────────────────────────────────────┤
│ Section 1 / 3 — Personal Info                  │
│                                                │
│ Full name *      [_______________________]     │
│ Phone *          [+1 ___ ___ ____]             │
│ Email            [_______________________]     │
│ Date of birth    [📅 ____-__-__]               │
│                                                │
│                  [ Next → ]                    │
│                                                │
│ ☑ I consent to be contacted (CASL)             │
│ Cloudflare Turnstile: ☑                         │
└────────────────────────────────────────────────┘
```

Mobile-first; auto-save in browser localStorage so partial fills aren't lost on refresh.

### Receptionist home `/f/clients/lookup`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Client lookup                                                            │
├──────────────────────────────────────────────────────────────────────────┤
│  Phone (E.164)   [+1 ___ ___ ____]                       [ Lookup ]      │
│                                                                          │
│  ──────  Result  ───────────────────────────────────────────────────────  │
│  ⓘ No client found.                                                      │
│       [+ Create new client]   [+ Walk-in lead]                            │
│                                                                          │
│  ── OR ──                                                                │
│                                                                          │
│  ✓ Found: John D.   ON-2026-00042                                        │
│    First seen 2026-02-12 · 2 prior consultations · 1 active case        │
│    [Open client]   [Book new consultation]                               │
│                                                                          │
│    Recent intakes:                                                       │
│    • 2026-04-26 — Free Consultation (form v3)  [view]                    │
│    • 2026-02-12 — Quick Eligibility           [view]                    │
└──────────────────────────────────────────────────────────────────────────┘
```

This screen is the receptionist's default landing. Auto-focus on phone field.

### Client 360 `/f/clients/[id]`

Tabs: Overview · Intakes · Appointments · Cases · Calls/SMS · Documents · Invoices · Notes

```
┌──────────────────────────────────────────────────────────────────────────┐
│ John D.   ON-2026-00042                          [▼ Actions]             │
│ +1 416 555 1212 · john@x.com · EN · Toronto Main                         │
├──────────────────────────────────────────────────────────────────────────┤
│ Overview                                                                 │
│  Status badges: 🗂 1 active case · 📅 1 upcoming appt · 💵 $0 due       │
│  Quick facts: DOB · Citizenship · Current status · Primary lawyer        │
│  Recent timeline (mixed events from intakes/calls/cases/appts)           │
└──────────────────────────────────────────────────────────────────────────┘
```

[▼ Actions] DOWN-END: Edit · Book consultation · Open new case · Send intake link · Merge with another client · Delete

### Calendar `/f/calendar`

Standard week view; click slot → "Book appointment" drawer (right):

```
┌──────────────────────────────────────┐
│ Book appointment                  [×]│
├──────────────────────────────────────┤
│ Client   [▼ Search by phone/name   ] │  ← Combobox; required
│                                       │
│ Staff    [▼ Sara L. (Lawyer)        ] │  ← only roles permitted by
│                                       │     ConsultationType.bookableBy
│                                       │
│ Type     [▼ Paid 30-min ($75)       ] │
│                                       │
│ Date     [📅 2026-05-02]              │
│ Start    [⏰ 10:00]   Duration 30 min │
│ Branch   [▼ Toronto Main            ] │
│                                       │
│ Notes    [______________________]    │
│                                       │
│ Pre-pay  ◉ Stripe link (email client)│
│          ○ Cash (collect at desk)    │
│          ○ Already paid              │
│                                       │
│             [Cancel]  [Book]          │
└──────────────────────────────────────┘
```

### Appointment detail / day-of

Receptionist opens it: prominent **[ Mark arrived ]** button (turns green when clicked); shows "intake form: ✓ submitted" or "✗ missing — [Send link]".

## CRUD matrix

| Entity | Action | Onsective | FirmAdmin | BranchMgr | Lawyer/Cons | Recept | Tele | Filer |
|---|---|---|---|---|---|---|---|---|
| IntakeForm | C/U/D | ✓ | ✓ | — | — | — | — | — |
| IntakeForm | R | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| IntakeSubmission | R | ✓ | ✓ | branch | own clients | branch | own leads | case-linked |
| ConsultationType | C/R/U/D | ✓ | ✓ | own branch | R | R | — | — |
| Client | C | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Client | R | ✓ | ✓ | branch | own | branch | own leads | own cases |
| Client | U | ✓ | ✓ | branch | own | branch | own | own cases |
| Client.delete | D | ✓ | ✓ | — | — | — | — | — |
| Appointment | C | ✓ | ✓ | ✓ | own (self-book) | ✓ | — | — |
| Appointment.markArrived | U | ✓ | ✓ | ✓ | — | ✓ | — | — |
| Appointment.cancel | U | ✓ | ✓ | ✓ | own | ✓ | — | — |
| StaffAvailability | C/R/U/D | ✓ | ✓ | own branch | own | — | — | — |

## Debug / observability

- Public submit endpoint: log slug, ip, ua, captcha score, parse-pass bool. Bot rate alert if > 100/hour anomaly.
- Phone normalization (libphonenumber) errors logged with raw input.
- Calendar conflicts: server checks overlap before insert; race condition test mandatory.
- PaymentIntent webhooks tied to appointment; mismatch alarms.
- Reminder job result counters: queued, sent, bounced.

## Performance budget

- Public intake form first paint < 1.2s on 3G.
- Phone lookup p95 < 100ms (`Client(tenantId, phone)` UNIQUE index).
- Calendar week view with 200 events: < 250ms render.

## Acceptance criteria

- [ ] Build a 3-section form with conditional logic; preview matches public render
- [ ] Public submit creates `IntakeSubmission`; if existing client (phone match) → linked; else stays unlinked until receptionist creates client
- [ ] Receptionist phone lookup resolves in <100ms; "create client" prefills from latest intake
- [ ] Booking flow: free + paid both work; paid sends Stripe checkout link via email; on payment → status `paid=true`
- [ ] Calendar conflict detection prevents double-booking; error visible inline
- [ ] T-24h email + T-2h SMS reminders fire (verified by job log)
- [ ] Mark arrived → status `ARRIVED` → consultation entity created when staff opens it (sets `IN_PROGRESS`)
- [ ] Cancel/reschedule release the slot and notify all parties
- [ ] Cross-tenant isolation test on intake submit (slug from tenant A cannot be saved into tenant B)

## Resume checkpoint

```
apps/web/src/app/i/[slug]/...                   ← public intake
apps/web/src/app/(firm)/clients/lookup/...
apps/web/src/app/(firm)/clients/[id]/...
apps/web/src/app/(firm)/calendar/...
apps/web/src/app/(firm)/appointments/...
apps/web/src/app/(firm)/masters/intake-forms/...
apps/web/src/app/(firm)/masters/consultation-types/...
packages/forms/                                 ← form builder + renderer
packages/jobs/apptReminder.ts, intakeFollowup.ts
packages/db/schema.prisma                       ← ConsultationType, StaffAvailability, TimeOff
```

Sit-back-down test: open `/i/<slug>` from your phone, submit a fake intake. Sign in as receptionist, lookup the phone — the new submission should be visible immediately, and "+ Create client" should prefill the form data. Book a paid appointment, pay the test Stripe link, then on the day mark arrived. If status flows correctly → Phase 4 done.
