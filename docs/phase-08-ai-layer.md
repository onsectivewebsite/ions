# Phase 8 — AI Layer (Form-Filling, Classification, Agent)

> **Goal:** AI accelerates the filer's work — classifies uploaded docs, extracts structured data, drafts IRCC form fields for human review, summarizes calls + consultations, and runs an agent that nudges clients for missing documents.
>
> **Done when:** A new uploaded passport is auto-tagged "PASSPORT" within 30s; case → AI form-fill draft fills 80%+ of an IMM 1295 work-permit form fields with confidence scores; lawyer reviews and approves; an agent run identifies a missing IELTS doc and SMS/emails the client without human action; per-tenant token usage is visible.

## Critical: usage of Anthropic SDK

This phase is the right place to invoke the **claude-api skill** when you actually start coding it. The skill enforces prompt caching, latest model IDs (Claude Sonnet 4.6 / Haiku 4.5), and pricing-aware patterns. Don't reach for OpenAI or any other provider — Onsective's stack is Claude.

## Routes

| URL | Who | What |
|---|---|---|
| `/f/cases/[id]/ai/draft` | filer/lawyer | AI form-fill workspace |
| `/f/cases/[id]/ai/classify` | filer | doc classification panel |
| `/f/cases/[id]/ai/agent` | filer/lawyer | run agent / view runs |
| `/f/ai/summaries` | staff | call & consult summaries inbox |
| `/f/settings/ai` | admin | enable features, set guardrails, usage cap, model selection |
| `/f/settings/ai/usage` | admin | cost dashboard |

## API surface

```
ai.classifyDocument({documentId})              → {tags, confidence, suggestedCategory}
ai.classifyBatch({documentIds})                → results[]
ai.transcribeRecording({callLogId})            → transcript + summary
ai.summarizeConsultation({consultationId})     → summary (saved to Consultation.aiSummary)

ai.formFill.draft({caseId, formCode})          → draftId
ai.formFill.get({draftId})                     → fields[] {key, value, confidence, source: documentId}
ai.formFill.update({draftId, fieldKey, value, locked?}) → ok
ai.formFill.exportPdf({draftId})               → URL (pre-filled IRCC form PDF)

ai.agent.run({caseId, mode})                   → runId   // mode: missing-docs | followup | next-action
ai.agent.runs({caseId})                        → AgentRun[]
ai.agent.stop({runId})                         → ok

ai.usage.tenant({period})                      → {promptTokens, completionTokens, costCents, byFeature}
ai.settings.get()                              → AiSettings
ai.settings.update(input)                      → AiSettings
```

## Database changes

```prisma
model AiSettings {
  tenantId        String   @id @db.Uuid
  enabled         Boolean  @default(false)
  classifyAuto    Boolean  @default(true)
  formFillEnabled Boolean  @default(true)
  agentEnabled    Boolean  @default(false)
  preferredModel  String   @default("claude-sonnet-4-6")
  monthlyBudgetCents BigInt @default(50000)   // CAD $500
  redactionLevel  String   @default("standard") // standard|strict
}

model AiFormDraft {
  id        String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId  String  @db.Uuid
  caseId    String  @db.Uuid
  formCode  String                              // "IMM1295" etc
  status    String                              // PROCESSING | READY | APPROVED | EXPORTED
  fields    Json                                // [{key,value,confidence,source}]
  approvedBy String? @db.Uuid
  approvedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model AiAgentRun {
  id        String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId  String  @db.Uuid
  caseId    String? @db.Uuid
  mode      String
  status    String                              // RUNNING | DONE | ERROR | STOPPED
  steps     Json                                // [{tool, input, output, ts}]
  result    Json?
  costCents Int?
  startedAt DateTime @default(now())
  endedAt   DateTime?
}

model AiUsage {
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId      String   @db.Uuid
  feature       String                          // classify|formfill|agent|summary|transcribe
  model         String
  inputTokens   Int
  cachedInputTokens Int @default(0)
  outputTokens  Int
  costCents     Int
  refType       String                          // Document | Case | CallLog | Consultation
  refId         String?  @db.Uuid
  createdAt     DateTime @default(now())
  @@index([tenantId, createdAt])
  @@index([tenantId, feature, createdAt])
}
```

## Background jobs

| Job | Purpose |
|---|---|
| `ai-classify` | Auto-classify each new document upload (if `AiSettings.classifyAuto`) |
| `ai-summarize-call` | After recording fetched, transcribe + summarize, append to CallLog + Lead |
| `ai-summarize-consult` | After consultation closed, summarize notes → `Consultation.aiSummary` |
| `ai-formfill-batch` | Triggered manually; processes one form-fill draft |
| `ai-agent-tick` | Cron 30 min for active agent runs needing follow-up actions |
| `ai-usage-rollup` | Hourly: aggregate to per-tenant per-feature totals + budget alarms |

## Pipelines (high level)

### Document classification
1. Pull document from R2.
2. If image: OCR (Tesseract or Claude vision).
3. Prompt Claude (Haiku) with: filename, OCR text head, list of tag candidates per case-type.
4. Apply suggested category if confidence > 0.8; otherwise present options to filer.

### Form-fill (IMM 1295 work permit example)
1. Inputs: client profile, intake answers, case docs (passport extracted fields, IELTS scores, employer letter parsed).
2. Pull IRCC form schema from `packages/ai/forms/imm1295.json` (we encode field map per form).
3. Use **prompt caching** for the form schema + system prompt (long, static).
4. Per-field reasoning with cited source `{documentId|intakeKey}`.
5. Save as `AiFormDraft` with confidence; UI lets human review/lock fields.
6. Export to a fillable PDF using pdf-lib + the IRCC PDF template.

### Agent (missing-docs chaser)
- Tools available: `getCase`, `getRequest`, `sendSmsToClient`, `sendEmailToClient`, `escalateToFiler`, `markStop`.
- Constraints: max 3 messages per run, 24h cooldown between runs per case, never sends after 9pm local.
- Each step recorded in `AiAgentRun.steps`. Can be stopped by user any time.

## Wireframes

### Form-fill workspace `/f/cases/[id]/ai/draft`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ AI Draft · IMM 1295 (Work Permit)                                        │
│ Case WP-2026-00123 · Status: READY for review                             │
├────────────────────────────────────────────┬─────────────────────────────┤
│ Field                Value      Conf   ⛌  │ Source                       │
│ Family name          DOE        0.99   🔒  │ passport_v2.pdf p.1          │
│ Given name           JOHN       0.99   🔒  │ passport_v2.pdf p.1          │
│ DOB                  1995-04-12 0.97   🔒  │ passport_v2.pdf p.1          │
│ Citizenship          INDIA      0.98       │ passport_v2.pdf p.1          │
│ Passport #           A1234567   0.99   🔒  │ passport_v2.pdf p.1          │
│ Marital status       SINGLE     0.85       │ intake.maritalStatus         │
│ Occupation (NOC)     2174       0.74   ⚠  │ employer_letter.pdf p.2      │
│ Employer name        Acme Corp  0.93       │ employer_letter.pdf p.1      │
│ Salary (CAD/yr)      85000      0.88       │ employer_letter.pdf p.1      │
│ ...                                                                     │
├────────────────────────────────────────────┴─────────────────────────────┤
│ Confidence < 0.8 highlighted ⚠                                          │
│ [Lock all] [Re-run AI] [Export PDF for review] [Send to lawyer]          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Settings → AI `/f/settings/ai`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ AI features                                                              │
├──────────────────────────────────────────────────────────────────────────┤
│ ☑ Master enable                                                          │
│ ☑ Auto-classify uploaded documents                                       │
│ ☑ Form-fill drafts                                                       │
│ ☐ Autonomous agent (sends client messages)                               │
│                                                                          │
│ Preferred model    [▼ Claude Sonnet 4.6]                                  │
│   options: Sonnet 4.6 (balanced) · Opus 4.7 (highest quality, $$) ·     │
│            Haiku 4.5 (cheap, classify only)                              │
│                                                                          │
│ Monthly budget    CAD $ [ 500 ]   Alert at 80%                           │
│                                                                          │
│ Redaction         [▼ Standard (PII redacted in prompts to model)        ]│
│                                                                          │
│ Data residency    Anthropic US (default)                                  │
│   ⓘ Note for client comms: see /04-security-and-compliance.md             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Usage dashboard `/f/settings/ai/usage`

Bar charts: tokens by feature this month, cost trend, top cost cases, budget consumed.

## CRUD matrix

| Entity | Action | Onsective | FirmAdmin | BranchMgr | Filer/CM | Lawyer | Client |
|---|---|---|---|---|---|---|---|
| AiSettings | R/U | ✓ | ✓ | — | — | — | — |
| AiFormDraft | C/U | ✓ | ✓ | ✓ | own case | own | — |
| AiFormDraft.approve | U | — | ✓ | ✓ | — | own case | — |
| AiAgentRun | C | ✓ | ✓ | ✓ | own case | own | — |
| AiAgentRun.stop | U | ✓ | ✓ | ✓ | own | own | — |
| AiUsage | R | ✓ | ✓ | own branch | — | — | — |

## Debug / observability

- Every Anthropic call logs: model, input tokens, cache-read tokens, output tokens, latency, cost cents.
- Cache hit rate per feature surfaced in usage dashboard (caching is mandatory; flag if < 50%).
- Hallucination guard: form-fill values must cite a source documentId or intake key; values without a source are flagged ⚠ and never auto-locked.
- Agent kill-switch in `AiSettings` and global env `AI_AGENT_DISABLED=true` for emergencies.
- Per-tenant rate limit on AI endpoints (default 60 req/min, configurable).
- PII redaction tested: emails, phone numbers, passport-like patterns removed in `strict` mode before sending to model.

## Performance budget

- Document classify p95 < 12s.
- Form-fill draft p95 < 60s for typical case (6-8 docs).
- Agent step latency < 30s.
- Cost per case (form-fill once) target < $0.50 CAD with caching.

## Acceptance criteria

- [ ] Upload a passport-like PDF → `category=PASSPORT` set automatically with confidence shown
- [ ] Run form-fill on a case with passport + IELTS + employer letter → draft has ≥ 80% fields populated, all cited
- [ ] Lock a field manually → re-run does not overwrite locked fields
- [ ] Export to PDF produces a fillable IRCC form aligned to spec
- [ ] Agent run identifies missing required document; sends one branded SMS + email; logs steps; stops at policy cap
- [ ] Quiet hours (≥ 9pm local) prevent agent send
- [ ] Usage dashboard shows accurate cost; budget threshold triggers email + UI banner
- [ ] Disabling AI in settings prevents all AI endpoints from accepting calls
- [ ] PII redaction strict mode: assert no plain phone/email/passport in outbound prompts (CI test with synthetic doc)

## Resume checkpoint

```
apps/web/src/app/(firm)/cases/[id]/ai/...
apps/web/src/app/(firm)/settings/ai/...
packages/ai/
   ├── client.ts                 ← Anthropic SDK with caching helpers
   ├── prompts/                  ← system prompts, version-tagged
   ├── forms/                    ← form schemas (IMM 1295, etc.)
   ├── pipelines/
   │   ├── classify.ts
   │   ├── formFill.ts
   │   ├── transcribeCall.ts
   │   └── summarizeConsult.ts
   ├── agents/
   │   └── missingDocs.ts
   ├── redact.ts
   └── usage.ts
packages/jobs/aiClassify.ts, aiSummarizeCall.ts, aiAgentTick.ts, aiUsageRollup.ts
packages/db/schema.prisma     ← AiSettings, AiFormDraft, AiAgentRun, AiUsage
```

Sit-back-down test: pick any case with at least 4 documents. Run AI form-fill. The draft should appear within ~60s with cited sources. Toggle Sonnet → Opus → re-run; quality should improve, cost should rise. If costs aren't dropping with cache reuse → caching headers misconfigured; the **claude-api** skill has the canonical pattern.
