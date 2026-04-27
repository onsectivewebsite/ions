# Phase 3 — Lead Pipeline + CRM + Twilio

> **Goal:** Telecallers work leads end-to-end inside OnsecBoad: leads arrive from web/Meta/TikTok/walk-in, auto-assign round-robin, telecaller calls/SMS/emails from inline buttons via Twilio, all logged with recording and KPIs.
>
> **Done when:** A test lead posted via API is assigned within seconds to a logged-in telecaller; they click "Call", browser softphone connects via Twilio Voice SDK to a personal phone, the call records, ends, and the call log + recording appears in the lead history within 30 seconds.

## Routes

| URL | Who | What |
|---|---|---|
| `/f/leads` | tele/admin/mgr | unified lead inbox |
| `/f/leads/[id]` | tele/admin/mgr | lead detail with timeline |
| `/f/leads/import` | admin/mgr | CSV import |
| `/f/calls` | tele | own call history |
| `/f/calls/[id]` | tele/admin/mgr | call detail + recording playback |
| `/f/campaigns` | admin/mgr | list |
| `/f/campaigns/new` | admin/mgr | composer (SMS / Email) |
| `/f/campaigns/[id]` | admin/mgr | stats |
| `/f/settings/integrations/twilio` | admin | Twilio creds + phone number |
| `/f/settings/integrations/meta` | admin | connect Meta page, lead form mapping |
| `/f/settings/integrations/tiktok` | admin | TikTok lead gen connect |
| `/f/settings/integrations/api-keys` | admin | issue/rotate firm API keys |
| `/f/settings/lead-rules` | admin/mgr | distribution rules editor |

## API surface

### tRPC

```
lead.list({page, q, status, assignedToMe, branchId, source, dateRange, language})
                                              → paginated
lead.get({id})                                → Lead + timeline
lead.create(input)                            → Lead
lead.update({id, ...})                        → Lead
lead.assign({id, userId})                     → Lead     // manual override
lead.bulkAssign({ids, userId})                → ok
lead.changeStatus({id, status, note?})        → Lead
lead.markDnc({id})                            → Lead
lead.merge({fromId, toId})                    → Lead
lead.import({csvKey, mapping})                → {processed, errors}
lead.exportCsv({filters})                     → presigned URL

call.token()                                  → Twilio Voice JWT (short-lived)
call.start({leadId|clientId, toNumber})       → CallLog (status=ringing)
call.end({callLogId, disposition?, notes?})   → CallLog
call.list({mine, dateRange, agentId, page})   → paginated
call.get({id})                                → CallLog + recording URL
call.recording.signedUrl({id})                → presigned (10 min)

sms.send({to, body, leadId|clientId})         → SmsLog

campaign.list()                               → Campaign[]
campaign.create(input)                        → Campaign
campaign.start({id})                          → ok
campaign.stats({id})                          → metrics

leadRule.list()                               → LeadRule[]
leadRule.update(input)                        → LeadRule[]   // ordered list

apiKey.list()                                 → ApiKey[]
apiKey.create({name, scopes})                 → {key, id}    // shown once
apiKey.revoke({id})                           → ok
```

### REST (public + webhooks)

- `POST /api/v1/leads/ingest` — Bearer firm API key. Body validated by zod.
  Returns `201 {id}` and triggers `lead-distribute`.
- `POST /api/v1/webhooks/meta-leadgen` — Meta-signed; pulls full lead by id.
- `POST /api/v1/webhooks/tiktok-leadgen` — signature verified.
- `POST /api/v1/webhooks/twilio-voice/incoming` — TwiML: route to available agent or voicemail.
- `POST /api/v1/webhooks/twilio-voice/status` — call status updates.
- `POST /api/v1/webhooks/twilio-recording/status` — recording ready → enqueue `recording-fetch`.
- `POST /api/v1/webhooks/twilio-sms/incoming` — inbound SMS → attach to lead/client.

## Database changes

- `Lead` (per `02-data-model.md`) + add fields: `dncFlag`, `consentMarketing`, `lastContactedAt`.
- `CallLog`, `SmsLog`, `EmailLog`, `Campaign`, `LeadCampaign` (per `02-data-model.md`).
- New `LeadRule`:
  ```prisma
  model LeadRule {
    id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
    tenantId    String   @db.Uuid
    priority    Int                          // lower = first
    name        String
    matchJson   Json                          // {source?, language?, branchId?, hourRange?}
    actionJson  Json                          // {assignTo: "round_robin"|userId, branchId?}
    isActive    Boolean  @default(true)
  }
  ```
- New `ApiKey`:
  ```prisma
  model ApiKey {
    id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
    tenantId    String   @db.Uuid
    name        String
    keyHash     String   @unique
    scopes      String[]
    createdBy   String   @db.Uuid
    createdAt   DateTime @default(now())
    revokedAt   DateTime?
    lastUsedAt  DateTime?
  }
  ```

## Background jobs

| Job | Purpose |
|---|---|
| `lead-distribute` | apply ordered LeadRules; default round-robin among active telecallers in branch; respect rotation cursor (Redis) |
| `recording-fetch` | download from Twilio → R2 with `tenant/calls/{id}.mp3`; update CallLog |
| `meta-poll-fallback` | every 15 min, pull lead forms not seen via webhook |
| `campaign-runner` | dispatch SMS/Email batches with throttle (Twilio/Resend rate limits) |
| `crm-deadline-followup` | nudge telecaller if a `FOLLOWUP` lead has no contact in 48h |

## Wireframes

### `/f/leads` (telecaller view — "My Leads")

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Leads                                                                    │
├──────────────────────────────────────────────────────────────────────────┤
│ View: [Mine ▼]  Status [▼ New + Followup]  Source [▼ All]  Lang [▼ All] │
│                                                  [⤓ Export]  [+ New lead]│
├──────────────────────────────────────────────────────────────────────────┤
│ ☐ Name           Phone           Source     Lang   Status    Last  Actions
│ ☐ John D.        +1 416 555 1212 Meta IG    EN     New       —    [📞][✉][📲][⋯]
│ ☐ Priya S.       +1 647 555 9090 Website    PA     Followup  3h   [📞][✉][📲][⋯]
│ ...                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

Inline action buttons:
- 📞 **Call** → opens softphone overlay (bottom-right) using Twilio Voice JWT
- ✉ **Email** → opens compose drawer (right) prefilled with templates
- 📲 **SMS** → quick send modal
- ⋯ DOWN-END: Open · Reassign · Mark DNC · Merge · Delete

### Softphone overlay (bottom-right floating)

```
                                                  ┌───────────────────────┐
                                                  │ ☎ Calling John D.     │
                                                  │   +1 416 555 1212     │
                                                  │   00:42                │
                                                  │                       │
                                                  │  [🔇][⏺][⏸][⌨][🔚]    │
                                                  │                       │
                                                  │ Disposition           │
                                                  │ [▼ Choose…         ]  │  ← UP-START (limited
                                                  │                       │     viewport)
                                                  │ Notes                 │
                                                  │ [____________________ │
                                                  │  ____________________]│
                                                  │                       │
                                                  │           [End & Save]│
                                                  └───────────────────────┘
```

Disposition dropdown options: Interested · Not interested · Wrong number · Voicemail · Callback · Do not call · Booked appointment

### `/f/leads/[id]` — detail

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Back                                                                   │
│ John D.   +1 416 555 1212    EN    Meta IG    [▼ Status: New]            │  ← status DOWN-START
├──────────────────────────────────────────────────────────────────────────┤
│  [📞 Call]  [✉ Email]  [📲 SMS]  [📅 Book consult]  [▼ More]              │
├──────────────────────────────────────────────────────────────────────────┤
│  Profile        Timeline        Notes        Documents (P5+)             │
├──────────────────────────────────────────────────────────────────────────┤
│  Timeline                                                                │
│  ▶ 2026-04-26 14:02  Lead created from Meta IG (form: "Free Consult")   │
│  ▶ 2026-04-26 14:03  Auto-assigned to Sara L.                           │
│  ▶ 2026-04-26 14:30  Call by Sara L. — 2:14 — Interested  [▶ play]      │
│  ▶ 2026-04-26 14:32  SMS sent: "Thanks John, link to intake form: ..."  │
│  ▶ 2026-04-26 14:45  Intake form submitted (link in profile)            │
└──────────────────────────────────────────────────────────────────────────┘
```

### `/f/calls/[id]` — call detail

Audio player (waveform), transcript (Phase 8 AI), disposition, edit notes, link to lead/client, download recording (admin only).

### `/f/settings/integrations/twilio`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Twilio integration                                                       │
├──────────────────────────────────────────────────────────────────────────┤
│ Account SID *      [_____________________________]                       │
│ Auth token *       [•••••••••••••••••]   [👁]                             │
│ TwiML app SID *    [_____________________________]                       │
│ Phone number *     [▼ +1 416 555 0000              ]   [Refresh list]    │
│ Recording          ☑ Record outbound calls                               │
│ Voicemail TwiML    [Use default ▼ | Custom URL ___]                      │
│                                                                          │
│ Connection status: [● Connected · 1 number · last test 2m ago]           │
│                                                                          │
│                       [Test connection]   [Save]                         │
└──────────────────────────────────────────────────────────────────────────┘
```

### `/f/settings/integrations/api-keys`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Firm API keys                                              [+ New key]   │
├──────────────────────────────────────────────────────────────────────────┤
│ Name              Scopes                Last used       Action            │
│ website-form      leads:write            5m             [⋯]               │
│ landingpages      leads:write            1d             [⋯]               │
└──────────────────────────────────────────────────────────────────────────┘
On create: modal shows the key ONCE; Copy button + warning "Save now — won't be shown again."
```

### `/f/settings/lead-rules`

```
Drag-and-drop ordered list of rules.
Each rule card:
  IF source = "Meta IG" AND language = "PA"
  THEN assign to "Punjabi telecallers" pool
                                                    [Edit] [Disable] [⋯]
[+ Add rule]
```

## CRUD matrix

| Entity | Action | Onsective | FirmAdmin | BranchMgr | Telecaller | Lawyer/Cons/Filer | Recept |
|---|---|---|---|---|---|---|---|
| Lead | C | ✓ | ✓ | ✓ | ✓ (manual) | — | ✓ (walk-in) |
| Lead | R | ✓ | tenant | branch | own queue | client-linked | branch (today) |
| Lead | U | ✓ | ✓ | ✓ | own | — | own walk-ins |
| Lead | D / Merge | ✓ | ✓ | ✓ | — | — | — |
| Lead.assign | U | ✓ | ✓ | ✓ | — | — | — |
| CallLog | R | ✓ | tenant | branch | own | client-linked | — |
| CallLog.start | C | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Recording | download | ✓ | ✓ | ✓ | own | own (consult) | — |
| Campaign | C/R/U/D | ✓ | ✓ | ✓ | R | — | — |
| ApiKey | C/R/U/D | ✓ | ✓ | — | — | — | — |
| TwilioConfig | R/U | ✓ | ✓ | — | — | — | — |
| LeadRule | C/R/U/D | ✓ | ✓ | ✓ (own branch) | — | — | — |

## Debug / observability

- Twilio webhooks idempotent via `twilioSid` UNIQUE.
- Softphone errors (mic permission, ICE failures) reported via Sentry breadcrumb.
- Per-agent KPIs cached in Redis, recomputed every minute: calls today, talk time, contact rate, avg handle time, dispositions breakdown.
- Lead distribution log table optional — when enabled, records why each lead was routed where.
- Recording fetch failures alert > 5/day; manual retry button on call detail.

## Performance budget

- Lead list page (10 K leads): server-side paginated p95 < 300ms.
- Click-to-call latency (button click → ringing): < 1.5s.
- Recording available in UI: ≤ 30s after call end.

## Acceptance criteria

- [ ] POST to `/api/v1/leads/ingest` with valid key creates lead; invalid key 401; missing fields 400 with details
- [ ] Round-robin distributes new leads across logged-in telecallers in target branch
- [ ] Manual reassign + bulk reassign update audit
- [ ] Click 📞 → softphone connects → call rings target → conversation → end
- [ ] Recording appears in lead timeline within 30s
- [ ] Disposition + notes saved on call end
- [ ] SMS send + inbound SMS attached to correct lead
- [ ] Meta lead webhook ingests + matches by phone with existing lead/client
- [ ] DNC flag prevents campaign send + outbound call (warn UI)
- [ ] Telecaller KPI dashboard shows correct numbers
- [ ] Twilio creds stored encrypted; visible only as masked in UI

## Resume checkpoint

```
apps/web/src/app/(firm)/leads/...
apps/web/src/app/(firm)/calls/...
apps/web/src/app/(firm)/campaigns/...
apps/web/src/app/(firm)/settings/integrations/...
apps/web/src/components/softphone/   ← Twilio Voice SDK wrapper
packages/integrations/twilio/
packages/integrations/meta/
packages/integrations/tiktok/
packages/jobs/leadDistribute.ts, recordingFetch.ts, campaignRunner.ts
packages/db/schema.prisma  ← LeadRule, ApiKey added
```

Sit-back-down test: from a curl with a firm API key, post a lead. Within 5s a logged-in telecaller should see it appear (WebSocket push) at the top of their queue with a notification chime. If not → check WebSocket connection and `lead-distribute` worker logs.
