# Phase 5 — Case Management & Retainer E-Sign

> **Goal:** After consultation, the case can be opened, a retainer drafted by case manager, approved by lawyer, e-signed by client (in-house signer), and the case enters `PENDING_DOCUMENTS`. Followup outcome routes back to telecaller queue automatically.
>
> **Done when:** A lawyer marks a consultation `RETAINER`; the system auto-creates a `Case` and assigns a filer + case manager; the case manager drafts retainer from a template, lawyer approves with one click, client receives a signing link, signs in browser with audit trail, and the case is `RETAINER_SIGNED` → `PENDING_DOCUMENTS`. A different consultation marked `FOLLOWUP` re-appears in the telecaller's lead queue with the right context.

## Routes

| URL | Who | What |
|---|---|---|
| `/f/consultations/[id]` | lawyer/cons | active consultation panel; outcome buttons |
| `/f/cases` | staff | case board (kanban) + table toggle |
| `/f/cases/new` | admin/mgr | manual case create (rare) |
| `/f/cases/[id]` | assigned + chain | case detail (tabs) |
| `/f/cases/[id]/retainer` | case mgr/lawyer | draft + approve retainer |
| `/f/masters/retainer-templates` | admin | template library |
| `/f/masters/case-types` | admin | case type CRUD (also feeds doc checklists in P6) |
| `/r/sign/[token]` | client (no app login) | retainer signing page |
| `/r/sign/[token]/done` | client | confirmation |

## API surface

```
consultation.start({appointmentId})            → Consultation
consultation.update({id, notes?, products?})   → Consultation
consultation.outcome({id, outcome, payload})   → Consultation
   outcome=DONE  → close
   outcome=RETAINER → create Case (auto-assign), return caseId
   outcome=FOLLOWUP → set client.lead reopen with context

case.list({view, status, mine, branchId, page})→ paginated
case.kanban({branchId})                         → grouped by status
case.get({id})                                  → Case + relations
case.create(input)                              → Case
case.assignFiler({id, userId})                  → Case
case.assignLawyer({id, userId})                 → Case
case.assignCaseManager({id, userId})            → Case
case.changeStatus({id, status, note?})         → Case (state-machine guarded)
case.addCollaborator({id, userId, role})       → ok
case.removeCollaborator({id, userId})          → ok
case.archive({id, reason})                     → ok

retainerTemplate.list()                         → RetainerTemplate[]
retainerTemplate.upsert(input)                  → RetainerTemplate
retainerTemplate.archive({id})                  → ok

retainer.draft({caseId, templateId, varOverrides?}) → Retainer (status=DRAFT)
retainer.update({id, html, signerName, email})      → Retainer
retainer.requestApproval({id})                       → Retainer (audit)
retainer.approve({id})                               → Retainer (status=READY)
retainer.send({id})                                  → Retainer (status=SENT) + email
retainer.publicGet({token})                          → safe payload (signing page)
retainer.publicAccept({token, signature, fields})    → Retainer (status=SIGNED)
retainer.decline({token, reason})                    → Retainer (status=DECLINED)
retainer.resend({id})                                → ok
retainer.voidIt({id, reason})                        → ok
```

## Database changes

- `Case`, `Consultation`, `Retainer`, `CaseType`, `CaseCollaborator` per `02-data-model.md`.
- New `RetainerTemplate`:
  ```prisma
  model RetainerTemplate {
    id          String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
    tenantId    String  @db.Uuid
    name        String
    bodyHtml    String                       // with {{variable}} placeholders
    variables   Json                          // [{key, label, type, required}]
    locale      String  @default("en-CA")
    isActive    Boolean @default(true)
  }
  ```

## State machine — Case

```
RETAINER_PENDING ──approve──▶ RETAINER_SIGNED ──auto──▶ PENDING_DOCUMENTS
       │
       └─decline──▶ CLOSED (lost)

PENDING_DOCUMENTS ──docs in──▶ IN_PREPARATION ──submit────▶ LAWYER_REVIEW
                                                ◀──changes──┘
LAWYER_REVIEW ──approve──▶ READY_TO_SUBMIT ──submitted──▶ SUBMITTED
SUBMITTED ──ack──▶ AWAITING_RESULT ──decision──▶ DECISION ──close──▶ CLOSED

Any non-terminal state ──admin override──▶ any state (audited)
```

Server enforces transitions in `case.changeStatus`.

## Background jobs

| Job | Purpose |
|---|---|
| `case-assign-on-retainer` | When consultation outcome=RETAINER: create Case, set caseCode, assign filer + case mgr by load-balancing |
| `retainer-pdf` | Render signed retainer to PDF (puppeteer/pdfkit), upload to R2, attach to case |
| `retainer-reminder` | If sent and unsigned in 48h, email reminder; second at 96h; expire at 14d |
| `consultation-followup` | If outcome=FOLLOWUP: re-emit to telecaller queue with priority `FOLLOWUP` |

## Wireframes

### Active consultation (`/f/consultations/[id]`)

Lawyer's view during consultation. Two-column:

```
┌──────────────────────────────────────────┬─────────────────────────────────┐
│ John D.   ON-2026-00042                  │ Client snapshot                 │
│ Type: Paid 30-min  ⏱ 18:42 elapsed       │ • DOB / age                      │
│                                          │ • Citizenship                    │
│ Past consultations (3)                   │ • Current status                 │
│  · 2026-02-12 — Quick Eligibility (Sara) │ • Last intake answers (collapsed)│
│  · 2025-09-03 — Free Consult (Anna)      │ • Past products discussed        │
│                                          │ • Open cases: none               │
│ Notes (autosave)                         │                                  │
│ [____________________________________]   │ Recommendation                   │
│                                          │ Products                         │
│                                          │ ☑ Work permit                    │
│                                          │ ☐ Study permit                   │
│                                          │ ☐ PR Express Entry               │
│                                          │                                  │
│                                          │ Outcome (required to close):     │
│                                          │ [ ✓ Done ] [ 📁 Retainer ]       │
│                                          │ [ ⏭ Followup ]                   │
└──────────────────────────────────────────┴─────────────────────────────────┘
```

Clicking [Retainer] opens "Open new case" modal:

```
┌────────────────────────────────────────────────────────┐
│ Open case from retainer                                │
├────────────────────────────────────────────────────────┤
│ Case type *      [▼ Work Permit                      ] │
│ Total fee (CAD)  [_______]    (default from CaseType)  │
│ Filer            [▼ Auto (load balance)              ] │
│ Case manager     [▼ Auto (load balance)              ] │
│ Lawyer (you)     [▼ self-locked                      ] │
│                                                        │
│ A draft retainer will be created next. You can edit     │
│ before approving.                                       │
│                                                        │
│                       [Cancel]  [Open case]            │
└────────────────────────────────────────────────────────┘
```

### Case board `/f/cases`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Cases                                          [Board] [Table]   [+ New] │
├──────────────────────────────────────────────────────────────────────────┤
│ Filters: Branch [▼] Type [▼] Filer [▼] Lawyer [▼] Status [▼ All open]   │
├──────────────────────────────────────────────────────────────────────────┤
│ Retainer    │ Pending     │ In Prep    │ Lawyer    │ Submitted │ Decision │
│ Pending(4)  │ Documents(7)│  (12)       │ Review(3) │  (8)      │  (5)     │
│ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │ ┌────────┐│ ┌────────┐│ ┌──────┐ │
│ │WP-...423│ │ │WP-...420│ │ │PR-...410│ │ │SP-..412││ │PR-..399││ │WP-380│ │
│ │John D.  │ │ │Priya S. │ │ │Mark T.  │ │ │Lily Z. ││ │Eric P. ││ │Yan L.│ │
│ │Filer:S. │ │ │Filer:M. │ │ │Filer:M. │ │ │Filer:A.││ │Filed:  ││ │Awtg  │ │
│ │$5000    │ │ │Locked   │ │ │ETA: 2d  │ │ │ETA: 1d ││ │2026-04 ││ │      │ │
│ └─────────┘ │ └─────────┘ │ └─────────┘ │ └────────┘│ └────────┘│ └──────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Drag card across columns → status change with confirm dialog if it skips a state.

### Case detail `/f/cases/[id]`

Tabs: Overview · Retainer · Documents (P6) · Tasks · Notes · Billing · Activity

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Back                                                                   │
│ WP-2026-00123  ·  John D.  ·  Work Permit  ·  Toronto Main               │
│ Status [▼ Pending Documents]  · Filer: Sara · Lawyer: Anna · CM: Rita    │  ← status DOWN-START
├──────────────────────────────────────────────────────────────────────────┤
│ Overview                                                                 │
│  Total fee   $5,000 CAD       Paid $1,500     Balance $3,500            │
│  Created     2026-04-26       Deadline (advisory) 2026-05-15            │
│  IRCC USI    —                IRCC file # —     Portal date —           │
│                                                                          │
│  Internal team                                                           │
│   • Anna K.  (Lawyer)        [Change]                                    │
│   • Sara L.  (Filer)         [Change]                                    │
│   • Rita V.  (Case manager)  [Change]                                    │
│   • Mark P.  (Collaborator)  [Remove]   [+ Add collaborator]             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Retainer drafting `/f/cases/[id]/retainer`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Retainer                                              [▼ Status: Draft]  │
├──────────────────────────────────────────────────────────────────────────┤
│ Template [▼ WP Standard EN                          ]                    │
│                                                                          │
│ Variables                                                                │
│  Client name         [John D.]                                           │
│  Service description [Work Permit application incl. ...]                 │
│  Fee total (CAD)     [5000]                                              │
│  Initial deposit     [1500]                                              │
│  Installment plan    [50% on filing, balance on submission]              │
│                                                                          │
│ Body preview (rich text editable)                                        │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │  RETAINER AGREEMENT                                                  │ │
│ │  Between Acme Immigration ("Firm") and John D. ("Client")            │ │
│ │  Service: Work Permit application...                                 │ │
│ │  ...                                                                 │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  Signer name [_________]   Signer email [_________]                      │
│                                                                          │
│  [ Save draft ]   [ Request lawyer approval ]   [ Preview as client ]    │
└──────────────────────────────────────────────────────────────────────────┘
```

After **Request approval** → lawyer sees task "Approve retainer" → opens same page with banner "AWAITING YOUR APPROVAL" + buttons [Approve & send] / [Request changes].

### Public signing `/r/sign/[token]`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Firm logo]                                                              │
│ Acme Immigration · Retainer for John D.                                  │
├──────────────────────────────────────────────────────────────────────────┤
│ ⓘ Please review the agreement below carefully.                           │
│                                                                          │
│ ┌─ Document ─────────────────────────────────────────────────────────┐   │
│ │ RETAINER AGREEMENT                                                 │   │
│ │ ...                                                                │   │
│ │ ...                                                                │   │
│ └────────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│ ☐ I have read and agree to the terms of this agreement                  │
│ ☐ I authorize Acme Immigration to act as my representative              │
│                                                                          │
│ Signature *                                                              │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │   (sign with mouse or finger)                            [ Clear ]  │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│ Full legal name *  [_________________________]                           │
│ Date              2026-04-26                                              │
│                                                                          │
│              [ Decline ]            [ Sign and submit ]                   │
└──────────────────────────────────────────────────────────────────────────┘
```

Audit trail captured per event: `viewed`, `scrolled-to-end`, `signed`, IP, UA, geo, timestamps.

After sign: PDF generated → R2; emailed to client + firm; case auto-advances to `PENDING_DOCUMENTS`; entry in case Activity tab.

## CRUD matrix

| Entity | Action | Onsective | FirmAdmin | BranchMgr | Lawyer | Cons | CaseMgr | Filer | Tele | Recept |
|---|---|---|---|---|---|---|---|---|---|---|
| Case | C | ✓ | ✓ | ✓ | ✓ (via consult) | ✓ | ✓ | — | — | — |
| Case | R | ✓ | tenant | branch | own assigned | own | own | own | client-linked | — |
| Case | U status | ✓ | ✓ | ✓ | own | own | own | own (limited) | — | — |
| Case.assign* | U | ✓ | ✓ | ✓ | — | — | (CM can change filer) | — | — | — |
| Case.archive | D | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| RetainerTemplate | C/R/U/D | ✓ | ✓ | — | R | R | R | R | — | — |
| Retainer | C/U | ✓ | ✓ | ✓ | own | own | own | — | — | — |
| Retainer.approve | U | ✓ | ✓ | ✓ | own | — | — | — | — | — |
| Retainer.send | U | ✓ | ✓ | ✓ | own | own | own | — | — | — |
| ConsultationOutcome | U | — | ✓ | ✓ | own | own | — | — | — | — |

## Debug / observability

- State-machine transitions: every change logs old/new state to AuditLog with user.
- Retainer signing audit trail kept as JSON on `Retainer.auditTrail` AND mirrored in AuditLog.
- PDF render failures retried 3x then alert.
- Followup re-routing: counter metric per outcome; alert if `FOLLOWUP` rate > 60% for any consultant (triage signal).

## Performance budget

- Case board with 500 cards: lazy-paginate per column; first paint < 600ms.
- Public signing page: < 1s on 4G; signature canvas latency < 16ms (60fps).
- PDF render p95 < 4s.

## Acceptance criteria

- [ ] Marking outcome=Retainer auto-creates a case, assigns filer + CM (load-balanced), sets fee from `CaseType.defaultFeeCents`
- [ ] Marking outcome=Followup updates lead status `FOLLOWUP`, surfaces in telecaller queue with consultation context
- [ ] Retainer draft → approval request → approve → send flow audited at each step
- [ ] Client signs in browser; PDF generated and stored; both parties emailed; case advances state
- [ ] Decline path captures reason, closes case as lost, audited
- [ ] State-machine prevents illegal transitions (e.g., DRAFT → SUBMITTED) — except admin override (with reason)
- [ ] Drag-card state change with skip prompts confirm dialog
- [ ] Reassigning filer/CM/lawyer logged + notifies new assignee
- [ ] Case detail visible only to assigned chain + admins; cross-role probe test passes

## Resume checkpoint

```
apps/web/src/app/(firm)/cases/...
apps/web/src/app/(firm)/consultations/[id]/...
apps/web/src/app/(firm)/masters/retainer-templates/...
apps/web/src/app/(firm)/masters/case-types/...
apps/web/src/app/r/sign/[token]/...           ← public signing
packages/esign/                                ← signature capture, audit, PDF render
packages/jobs/caseAssignOnRetainer.ts, retainerPdf.ts, retainerReminder.ts
packages/db/schema.prisma                      ← RetainerTemplate added
```

Sit-back-down test: complete a consultation → mark Retainer → draft retainer with default template → request approval → approve → email yourself → sign on phone → confirm Case is `PENDING_DOCUMENTS` and signed PDF visible in case detail. If not, the e-sign pipeline is broken; check `packages/esign` first.
