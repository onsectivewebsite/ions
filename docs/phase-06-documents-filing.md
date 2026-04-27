# Phase 6 — Documents, Collection Links, Filing Workflow

> **Goal:** Per case-type document checklists drive a client-facing collection link; filer prepares the file, lawyer reviews, IRCC fields are tracked. Re-uploads supersede prior versions and old objects are deleted from R2 to manage space. Internal collaboration on a case is supported.
>
> **Done when:** A `PENDING_DOCUMENTS` case has a "Send collection link" button that emails/SMS-es the client a one-time URL; client uploads required docs (with one re-upload to test version-purge); link auto-locks; admin unlocks for one more upload; filer assembles file, sends to lawyer; lawyer approves; case advances to `READY_TO_SUBMIT` with USI/file/portal-date fields editable.

## Routes

| URL | Who | What |
|---|---|---|
| `/f/cases/[id]/documents` | filer/CM/lawyer | docs tab |
| `/f/cases/[id]/requests/new` | filer/CM | new collection request |
| `/f/cases/[id]/requests/[rid]` | filer/CM | manage one request |
| `/f/cases/[id]/file` | filer | file assembly workspace |
| `/f/cases/[id]/ircc` | filer/lawyer | IRCC fields panel |
| `/f/masters/case-types/[id]/checklist` | admin | edit doc checklist for case type |
| `/c/upload/[token]` | client (public) | document collection portal page |
| `/c/upload/[token]/done` | client | confirmation |

## API surface

```
caseType.checklistGet({id})                      → checklist
caseType.checklistUpdate({id, items})            → checklist
   item: {label, required, sample?, allowMultiple, fileTypes, maxSizeMb, helpText}

documentRequest.create({caseId, items, expiresAt?})  → DocumentRequest + token
documentRequest.list({caseId})                       → DocumentRequest[]
documentRequest.get({id})                            → DocumentRequest + items
documentRequest.lock({id})                           → DocumentRequest
documentRequest.unlock({id})                         → DocumentRequest      // admin/branchMgr only
documentRequest.resendLink({id, channel})            → ok
documentRequest.publicGet({token})                   → safe payload
documentRequest.publicUpload({token, itemId})        → presigned PUT to R2
documentRequest.publicSubmit({token})                → DocumentRequest (status=SUBMITTED)

document.list({caseId, currentOnly?})            → Document[]
document.uploadPresign({caseId, category, fileName, contentType})
                                                  → {key, presigned PUT, documentId draft}
document.completeUpload({documentId})            → Document
document.replace({id, fileName, contentType})    → {key, presigned PUT, newDocumentId}
   (purges prior file from R2 after the new one is committed)
document.classifyAi({id})                        → tags  (Phase 8)
document.delete({id})                            → ok      // soft delete + R2 delete

case.assemble({id, plan})                        → ok      // record manifest + checksums
case.submitForReview({id})                       → Case (status=LAWYER_REVIEW)
case.requestChanges({id, comments})              → Case (status=IN_PREPARATION)
case.lawyerApprove({id})                         → Case (status=READY_TO_SUBMIT)
case.recordSubmission({id, irccFile, usi, portalDate}) → Case (status=SUBMITTED)
case.recordDecision({id, result, date, notes})         → Case (status=DECISION)
```

### REST (public)

- `GET /api/v1/upload/[token]` — return safe schema for the page
- `POST /api/v1/upload/[token]/items/[itemId]` — get presigned R2 PUT
- `POST /api/v1/upload/[token]/submit` — finalize submission (locks request)

## Database changes

- `Document`, `DocumentRequest`, `DocumentRequestItem` per `02-data-model.md`.
- Add `Document.contentSha256` for tamper-evidence.
- Add `Document.scanStatus` (`pending|clean|infected|skipped`) for optional AV (ClamAV worker).
- Add per-tenant per-case-type `defaultExpiryDays` for collection links.
- Add `CaseAssembly`:
  ```prisma
  model CaseAssembly {
    id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
    tenantId      String   @db.Uuid
    caseId        String   @db.Uuid
    manifest      Json                          // [{label, documentId, sha256}]
    preparedBy    String   @db.Uuid
    preparedAt    DateTime @default(now())
    status        String                          // PENDING_REVIEW | APPROVED | CHANGES_REQUESTED
    lawyerNotes   String?
  }
  ```

## Background jobs

| Job | Purpose |
|---|---|
| `document-purge` | After successful re-upload commit: delete prior R2 object; mark old `Document.deletedAt` |
| `document-virus-scan` | Stream new uploads to ClamAV; mark `scanStatus`; quarantine if infected |
| `request-link-expire` | Cron daily: expire links past `expiresAt` |
| `request-followup` | If request `PENDING` > 48h, send reminder to client; alert filer at 96h |
| `case-deadline-alert` | Alerts at T-72h, T-24h, T-2h on `Case.filingDeadline` |
| `ai-doc-classify` | (Phase 8) classify each new upload (passport/IELTS/transcript/etc.) |

## Wireframes

### Master: doc checklist editor `/f/masters/case-types/[id]/checklist`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Case type: Work Permit                                                   │
│ Document checklist                                          [+ Add item] │
├──────────────────────────────────────────────────────────────────────────┤
│ # Label                       Required  Files     Sample        ⋯        │
│ 1 Passport (bio page)           ✓        PDF/JPG  [⤓ sample]  [⋯]       │
│ 2 IELTS scorecard                ✓        PDF      [—]         [⋯]       │
│ 3 Education transcripts          ✓        PDF      [⤓ sample]  [⋯]       │
│ 4 Job offer letter (LMIA?)       ✓        PDF      [—]         [⋯]       │
│ 5 Proof of funds                 ✓        PDF      [—]         [⋯]       │
│ 6 Marriage certificate           ✗        PDF      [—]         [⋯]       │
│   Drag to reorder.                                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

[+ Add item] drawer fields: label, required toggle, allowed file types, max size, sample file upload, help text.

### Case → Documents tab `/f/cases/[id]/documents`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Documents                                            [+ Send collection] │
├──────────────────────────────────────────────────────────────────────────┤
│ Active request: REQ-9821 · Sent 2h ago · Status PARTIAL · Expires 7d    │
│                                                  [Resend] [Lock] [Unlock]│
├──────────────────────────────────────────────────────────────────────────┤
│ Required                Status        File                  Action        │
│ Passport bio page       ✓ Received    passport_v2.pdf       [⋯]          │
│ IELTS scorecard         ⏳ Awaiting   —                      [Upload now] │
│ Education transcripts   ✓ Received    transcripts.pdf v1    [⋯]          │
│ Job offer letter        ⏳ Awaiting   —                                   │
│ Proof of funds          ✓ Received    funds_2024.pdf        [⋯]          │
│                                                                          │
│ Optional                                                                 │
│ Marriage certificate    —             —                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

Row [⋯] DOWN-END: Open · Replace (re-upload) · Download · View versions · Mark verified · Delete.

### Send collection link drawer

```
┌──────────────────────────────────────┐
│ Send document collection             │
├──────────────────────────────────────┤
│ Items (from case-type checklist)     │
│   ☑ Passport bio page (required)     │
│   ☑ IELTS scorecard (required)       │
│   ☑ Transcripts (required)           │
│   ☑ Job offer letter (required)      │
│   ☑ Proof of funds (required)        │
│   ☐ Marriage certificate (optional)  │
│                                       │
│ Channel  ◉ Email  ○ SMS  ○ Both       │
│ Expires  [▼ 14 days]                  │
│ Custom note (optional)                │
│ [____________________________________]│
│                                       │
│              [Cancel]  [Send link]    │
└──────────────────────────────────────┘
```

### Public upload `/c/upload/[token]`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Firm logo]                                                              │
│ Acme Immigration · Documents needed for John D.                          │
├──────────────────────────────────────────────────────────────────────────┤
│ ⓘ Upload the items below. You can save and return any time before        │
│    submitting. After you submit, only your firm can re-open this link.   │
│                                                                          │
│ 1 / 6  Passport bio page  *required                                      │
│   ┌──────────────────────────────────┐                                   │
│   │ Drag and drop or [ Choose file ] │   ⤓ Sample / instructions          │
│   └──────────────────────────────────┘                                   │
│   ✓ passport.pdf (1.2 MB) uploaded.   [ Replace ]                        │
│                                                                          │
│ 2 / 6  IELTS scorecard *required                                         │
│   ┌──────────────────────────────────┐                                   │
│   │ Drag and drop or [ Choose file ] │                                   │
│   └──────────────────────────────────┘                                   │
│ ...                                                                      │
│                                                                          │
│ Save progress is automatic. When all required items are uploaded,        │
│                  [ Submit to firm → ]                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

After submit: link state = `SUBMITTED`, becomes read-only. Cannot re-upload unless firm unlocks.

### File assembly `/f/cases/[id]/file`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ File assembly                                                            │
│ Status: IN PREPARATION                                                   │
├──────────────────────────────────────────────────────────────────────────┤
│ Cover sheet template [▼ WP submission cover                            ] │
│ Order docs (drag to reorder)                                             │
│   1. passport_v2.pdf                                                     │
│   2. transcripts.pdf                                                     │
│   3. ielts_2024.pdf                                                      │
│   4. job_offer.pdf                                                       │
│   5. funds_2024.pdf                                                      │
│                                                                          │
│ Notes for lawyer                                                         │
│ [_____________________________________________________________________]  │
│                                                                          │
│  [ Generate cover sheet ]   [ Send to lawyer for review → ]              │
└──────────────────────────────────────────────────────────────────────────┘
```

Send → case → `LAWYER_REVIEW` → lawyer's task list shows it.

### Lawyer review

Lawyer opens case; banner "AWAITING YOUR REVIEW"; preview of assembled docs (PDF inline viewer); buttons:
- [ ✓ Approve & mark Ready to Submit ]
- [ ✎ Request changes ] → opens textarea + reason → status back to `IN_PREPARATION`

### IRCC fields panel `/f/cases/[id]/ircc`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ IRCC submission                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ USI number          [_____________________]                              │
│ IRCC file number    [_____________________]                              │
│ Portal upload date  [📅 ____-__-__]                                       │
│                                                                          │
│   [ Mark Submitted ]                                                     │
│                                                                          │
│ After submission                                                          │
│ Acknowledgement on  [📅 ____-__-__]                                       │
│ Decision date       [📅 ____-__-__]                                       │
│ Result               [▼ —]                                                │
│ Notes               [______________________]                             │
└──────────────────────────────────────────────────────────────────────────┘
```

`[ Mark Submitted ]` is **disabled** if Phase 7 fee gate is unmet (balance > 0). Tooltip explains.

## CRUD matrix

| Entity | Action | Onsective | FirmAdmin | BranchMgr | Lawyer | Cons | CaseMgr | Filer | Tele | Recept |
|---|---|---|---|---|---|---|---|---|---|---|
| CaseType.checklist | C/R/U/D | ✓ | ✓ | — | R | R | R | R | — | — |
| DocumentRequest | C | ✓ | ✓ | ✓ | own case | own | own | own | — | — |
| DocumentRequest | R | ✓ | tenant | branch | own case | own | own | own | — | — |
| DocumentRequest.lock | U | auto on submit | ✓ | ✓ | — | — | — | — | — | — |
| DocumentRequest.unlock | U | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| Document | C (upload) | ✓ | ✓ | ✓ | own case | own | own | own | — | — |
| Document | R | ✓ | tenant | branch | case | case | case | case | — | — |
| Document.replace | U | ✓ | ✓ | ✓ | own case | own | own | own | — | — |
| Document | D | ✓ | ✓ | ✓ | — | — | — | — | — | — |
| CaseAssembly | C/U | ✓ | ✓ | ✓ | — | own | own | own | — | — |
| Case.lawyerApprove | U | ✓ | ✓ | ✓ | own case | — | — | — | — | — |
| Case.recordSubmission | U | ✓ | ✓ | ✓ | own | — | — | own (if balance=0) | — | — |

## Debug / observability

- Upload pipeline: log each presign issued, completed, failed, and orphan PUTs (presigned but never finalized) — daily job removes them from R2.
- Re-upload purge: log old key + new key + sha256 + bytes saved.
- Virus-scan failures alert immediately; quarantine bucket holds infected files for 30 days.
- Tamper check: scheduled job recomputes sha256 of random sample of `Document` rows monthly; alert on mismatch.
- Storage usage per tenant per case computed daily; surfaced in admin dashboard.
- Public link probe: cron pings random recent links to confirm they resolve.

## Performance budget

- Public upload page: works on 3G; multipart upload with progress bar; chunked > 10MB.
- R2 PUT throughput: 50MB file in < 30s on average client connection (parallelism 4).
- Documents tab with 50 items: < 300ms render.

## Acceptance criteria

- [ ] Admin defines a checklist for "Work Permit" with 5 required + 1 optional item, including a sample PDF
- [ ] Filer sends collection link via email + SMS; client receives both
- [ ] Client uploads 4 of 5 required → can save & return; submit button stays disabled
- [ ] Client uploads 5/5 → submit enabled → submit → link locked
- [ ] Filer attempts upload on locked request → blocked; admin clicks Unlock; client now can replace
- [ ] Replace flow purges prior R2 object; old version row marked `deletedAt`; metrics reflect bytes saved
- [ ] Filer assembles file, sends for lawyer review; lawyer requests changes → status reverts; lawyer approves → status `READY_TO_SUBMIT`
- [ ] IRCC submit blocked when balance > 0 (assertion verified once Phase 7 ships; for P6, simulate via test data)
- [ ] Versions are visible per document; download serves the current version
- [ ] AV scan: a known-bad EICAR test file is quarantined and alert fires

## Resume checkpoint

```
apps/web/src/app/(firm)/cases/[id]/documents/...
apps/web/src/app/(firm)/cases/[id]/file/...
apps/web/src/app/(firm)/cases/[id]/ircc/...
apps/web/src/app/(firm)/masters/case-types/[id]/checklist/...
apps/web/src/app/c/upload/[token]/...
packages/storage/                              ← R2 wrapper, presign, purge
packages/jobs/documentPurge.ts, requestLinkExpire.ts, requestFollowup.ts, caseDeadlineAlert.ts
packages/db/schema.prisma                       ← CaseAssembly, Document.contentSha256, scanStatus
```

Sit-back-down test: upload a 20MB PDF as a client, then re-upload a smaller version. Check R2 — only the smaller one should remain. Check `Document` table — the old row has `deletedAt` set, the new one is `isCurrent=true`. If both files still exist in R2 → `document-purge` job is broken; check its logs.
