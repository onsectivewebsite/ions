# 02 — Data Model

This is the canonical schema. All phase docs reference table names from here. Implemented as Prisma schema in `packages/db/schema.prisma`.

## Conventions

- All ids: `UUID v7` (time-sortable). Prisma: `@default(dbgenerated("uuidv7()"))` (Postgres extension).
- All tables (except `tenant`, platform-level tables): `tenant_id UUID NOT NULL` indexed first in composite indexes.
- Soft delete: `deleted_at TIMESTAMPTZ NULL`; queries filter via Prisma middleware.
- Audit timestamps: `created_at`, `updated_at`, `created_by`, `updated_by`.
- Money: `BIGINT` cents + `currency CHAR(3)` (CAD default). Never floats.
- Phone numbers: E.164 format, validated at write.

## Entity-relationship overview

```
                    ┌──────────────┐
                    │  Onsective   │ (platform-level; not tenant-scoped)
                    │  PlatformUser│
                    └───────┬──────┘
                            │
                            ▼ provisions
                    ┌──────────────┐
                    │   Tenant     │ (= Law Firm)
                    │ (subscription│
                    │  + branding) │
                    └───┬───────┬──┘
              ┌─────────┘       └─────────┐
              ▼                           ▼
        ┌──────────┐                ┌────────┐
        │  Branch  │                │  User  │ (firm staff)
        └────┬─────┘                └────┬───┘
             │  scopes                   │ has
             │                           ▼
             │                    ┌───────────┐
             │                    │ Role +    │
             │                    │Permission │
             │                    └───────────┘
             ▼
        ┌────────────────────────────────────────────┐
        │  Lead → Appointment → Consultation → Case  │
        │   (one client identity throughout)         │
        └────┬───────────────────┬───────────────────┘
             │                   │
             ▼                   ▼
        ┌──────────┐        ┌────────────┐
        │  Client  │◄──────►│  Document  │ (per case)
        │ (phone=PK│        │  + Versions│
        │ business)│        └────────────┘
        └────┬─────┘
             │
             ▼
        ┌──────────────┐
        │ ClientPortal │
        │ Account      │
        └──────────────┘
```

## Schema (Prisma)

### Platform-level (not tenant-scoped)

```prisma
model PlatformUser {
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  email         String   @unique
  name          String
  passwordHash  String?
  twoFASecret   String?  // TOTP
  passkeys      Passkey[]
  isSuperadmin  Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  lastLoginAt   DateTime?
}

model Tenant {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  legalName       String
  displayName     String
  slug            String   @unique          // becomes subdomain
  status          TenantStatus              // PROVISIONING|ACTIVE|SUSPENDED|CANCELED
  subscriptionId  String?                   // Stripe subscription
  packageTier     PackageTier               // STARTER|GROWTH|SCALE
  seatCount       Int      @default(0)
  branding        Json                       // {theme, primary, secondary, logoUrl, ...}
  twilio          Json?                      // {accountSid, authToken (encrypted), phoneNumber}
  emailFrom       String?
  locale          String   @default("en-CA")
  timezone        String   @default("America/Toronto")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  branches        Branch[]
  users           User[]
  // ... back-references for every tenant-scoped table
  @@index([status])
}

enum TenantStatus { PROVISIONING ACTIVE SUSPENDED CANCELED }
enum PackageTier { STARTER GROWTH SCALE }
```

### Tenant-scoped: org structure

```prisma
model Branch {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String   @db.Uuid
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  name        String
  address     Json     // {line1, line2, city, province, postalCode, country}
  phone       String
  email       String?
  managerId   String?  @db.Uuid
  manager     User?    @relation("BranchManager", fields: [managerId], references: [id])
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  users       User[]   @relation("BranchUsers")
  leads       Lead[]
  cases       Case[]
  appointments Appointment[]

  @@unique([tenantId, name])
  @@index([tenantId])
}

model User {
  id            String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId      String   @db.Uuid
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  email         String
  name          String
  phone         String?
  passwordHash  String?
  twoFASecret   String?  // TOTP secret (encrypted at rest)
  passkeys      Passkey[]
  branchId      String?  @db.Uuid
  branch        Branch?  @relation("BranchUsers", fields: [branchId], references: [id])
  managedBranches Branch[] @relation("BranchManager")
  roleId        String   @db.Uuid
  role          Role     @relation(fields: [roleId], references: [id])
  status        UserStatus @default(INVITED)
  isBillable    Boolean  @default(true)  // counts toward seat billing
  invitedAt     DateTime?
  joinedAt      DateTime?
  lastLoginAt   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  @@unique([tenantId, email])
  @@index([tenantId, roleId])
  @@index([tenantId, branchId])
}

enum UserStatus { INVITED ACTIVE DISABLED }

model Role {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String   @db.Uuid
  name        String              // FIRM_ADMIN, BRANCH_MANAGER, LAWYER, CONSULTANT, FILER, CASE_MANAGER, TELECALLER, RECEPTIONIST, CUSTOM_*
  isSystem    Boolean  @default(false)
  permissions Json                // {leads:["read","write"], cases:["read"], ...}
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([tenantId, name])
}

model Passkey {
  id              String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId          String? @db.Uuid
  user            User?   @relation(fields: [userId], references: [id])
  platformUserId  String? @db.Uuid
  platformUser    PlatformUser? @relation(fields: [platformUserId], references: [id])
  credentialId    Bytes   @unique
  publicKey       Bytes
  counter         Int
  deviceType      String
  transports      String[]
  createdAt       DateTime @default(now())
  lastUsedAt      DateTime?
}

model Session {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  userId      String?  @db.Uuid
  platformUserId String? @db.Uuid
  refreshTokenHash String @unique
  device      String
  ip          String
  expiresAt   DateTime
  createdAt   DateTime @default(now())
  revokedAt   DateTime?
}

model AuditLog {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String?  @db.Uuid          // null = platform action
  actorId     String   @db.Uuid
  actorType   ActorType
  action      String                       // "lead.create", "case.assign_filer", ...
  targetType  String                       // "Lead", "Case", ...
  targetId    String?  @db.Uuid
  payload     Json?
  ip          String?
  userAgent   String?
  createdAt   DateTime @default(now())

  @@index([tenantId, createdAt])
  @@index([targetType, targetId])
}

enum ActorType { PLATFORM USER CLIENT SYSTEM }
```

### Lead → Client → Case pipeline

```prisma
model Lead {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  branchId        String?  @db.Uuid
  source          LeadSource
  sourceMeta      Json?    // ad id, campaign, referral details
  fullName        String
  phone           String   // E.164
  email           String?
  language        String?
  notes           String?
  status          LeadStatus @default(NEW)
  assignedTo      String?  @db.Uuid    // telecaller user id
  assignedAt      DateTime?
  clientId        String?  @db.Uuid    // populated once converted
  appointmentId   String?  @db.Uuid    // populated once booked
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  callLogs        CallLog[]
  campaigns       LeadCampaign[]

  @@index([tenantId, status])
  @@index([tenantId, assignedTo])
  @@index([tenantId, phone])
}

enum LeadSource { WALK_IN REFERRAL META_FB META_IG TIKTOK WEBSITE_API CSV_IMPORT MANUAL }
enum LeadStatus { NEW CONTACTED INTERESTED NOT_INTERESTED FOLLOWUP CONVERTED LOST }

model Client {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  clientCode      String                          // human-friendly: e.g., "ON-2026-00042"
  fullName        String
  phone           String   // E.164 — primary business key with tenantId
  email           String?
  dob             DateTime?
  gender          String?
  passportNumber  String?
  citizenship     String?
  currentStatus   String?                         // current immigration status
  intakeDataJson  Json?                           // last submitted intake form
  preferredLang   String?
  marketingConsent Boolean @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  appointments    Appointment[]
  consultations   Consultation[]
  cases           Case[]
  intakes         IntakeSubmission[]
  documents       Document[]
  invoices        Invoice[]
  portalAccount   ClientPortalAccount?

  @@unique([tenantId, clientCode])
  @@unique([tenantId, phone])     // phone is the business primary key
  @@index([tenantId, fullName])
}

model IntakeForm {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String   @db.Uuid
  name        String
  schema      Json                  // dynamic field definition
  isPublic    Boolean  @default(true)
  publicSlug  String?  @unique      // public URL token
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model IntakeSubmission {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String   @db.Uuid
  formId      String   @db.Uuid
  form        IntakeForm @relation(fields: [formId], references: [id])
  clientId    String?  @db.Uuid
  client      Client?  @relation(fields: [clientId], references: [id])
  data        Json
  ip          String?
  submittedAt DateTime @default(now())

  @@index([tenantId, clientId])
}

model Appointment {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  branchId        String   @db.Uuid
  clientId        String   @db.Uuid
  staffUserId     String   @db.Uuid               // lawyer or consultant
  consultationType String                          // "FREE", "PAID_30", "PAID_60", custom
  feeCents        BigInt   @default(0)
  currency        String   @default("CAD")
  status          AppointmentStatus @default(SCHEDULED)
  scheduledStart  DateTime
  scheduledEnd    DateTime
  arrivedAt       DateTime?
  completedAt     DateTime?
  paymentIntentId String?                          // Stripe PI
  paid            Boolean  @default(false)
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  consultation    Consultation?
  @@index([tenantId, scheduledStart])
  @@index([tenantId, staffUserId, scheduledStart])
}

enum AppointmentStatus { SCHEDULED ARRIVED IN_PROGRESS COMPLETED NO_SHOW CANCELED }

model Consultation {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  appointmentId   String   @db.Uuid @unique
  appointment     Appointment @relation(fields: [appointmentId], references: [id])
  clientId        String   @db.Uuid
  staffUserId     String   @db.Uuid
  outcome         ConsultationOutcome
  outcomeReason   String?
  recommendation  String?     // free-text
  productsDiscussed String[]  // e.g., ["WORK_PERMIT","STUDY_PERMIT"]
  recordingUrl    String?
  aiSummary       String?
  createdAt       DateTime @default(now())

  @@index([tenantId, clientId])
}

enum ConsultationOutcome { DONE RETAINER FOLLOWUP }

model Case {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  branchId        String   @db.Uuid
  caseCode        String                           // e.g., "WP-2026-00123"
  clientId        String   @db.Uuid
  caseTypeId      String   @db.Uuid                // master: WORK_PERMIT, STUDY_PERMIT, etc.
  status          CaseStatus @default(RETAINER_PENDING)
  filerId         String?  @db.Uuid
  lawyerId        String?  @db.Uuid
  caseManagerId   String?  @db.Uuid
  totalFeeCents   BigInt
  currency        String   @default("CAD")
  usiNumber       String?
  irccFileNumber  String?
  irccPortalDate  DateTime?
  filingDeadline  DateTime?
  decisionDate    DateTime?
  decisionResult  String?                          // APPROVED|REFUSED|WITHDRAWN
  metadata        Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  closedAt        DateTime?

  retainer        Retainer?
  documents       Document[]
  invoices        Invoice[]
  collaborators   CaseCollaborator[]
  documentRequests DocumentRequest[]

  @@unique([tenantId, caseCode])
  @@index([tenantId, status])
  @@index([tenantId, filerId])
  @@index([tenantId, clientId])
}

enum CaseStatus {
  RETAINER_PENDING
  RETAINER_SIGNED
  PENDING_DOCUMENTS
  IN_PREPARATION
  LAWYER_REVIEW
  READY_TO_SUBMIT
  SUBMITTED
  AWAITING_RESULT
  DECISION
  CLOSED
}

model CaseCollaborator {
  caseId    String @db.Uuid
  userId    String @db.Uuid
  case      Case   @relation(fields: [caseId], references: [id])
  role      String  // "filer_helper", "consultant", etc.
  addedAt   DateTime @default(now())
  @@id([caseId, userId])
}

model CaseType {
  id          String  @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String  @db.Uuid
  code        String                  // WORK_PERMIT, STUDY_PERMIT, PR_EE, etc.
  name        String
  defaultFeeCents BigInt @default(0)
  documentChecklist Json              // [{label, required, sample, ...}]
  isActive    Boolean @default(true)
  @@unique([tenantId, code])
}
```

### Documents

```prisma
model DocumentRequest {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  caseId          String   @db.Uuid
  case            Case     @relation(fields: [caseId], references: [id])
  publicToken     String   @unique
  status          DocumentRequestStatus @default(PENDING)
  lockedAt        DateTime?
  unlockedBy      String?  @db.Uuid
  expiresAt       DateTime?
  createdAt       DateTime @default(now())
  items           DocumentRequestItem[]
}

enum DocumentRequestStatus { PENDING PARTIAL SUBMITTED LOCKED REOPENED }

model DocumentRequestItem {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  requestId   String   @db.Uuid
  request     DocumentRequest @relation(fields: [requestId], references: [id])
  label       String
  required    Boolean
  documentId  String?  @db.Uuid
  document    Document? @relation(fields: [documentId], references: [id])
}

model Document {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  clientId        String?  @db.Uuid
  caseId          String?  @db.Uuid
  category        String                   // "PASSPORT", "IELTS", ...
  fileName        String
  contentType     String
  sizeBytes       BigInt
  storageKey      String                   // R2 object key
  uploadedBy      String?  @db.Uuid        // null = client uploaded
  uploadedByClient Boolean @default(false)
  version         Int      @default(1)
  supersededBy    String?  @db.Uuid        // self-relation
  isCurrent       Boolean  @default(true)
  aiTags          Json?
  createdAt       DateTime @default(now())
  deletedAt       DateTime?

  versions        Document[] @relation("Versions", fields: [], references: [])
  requestItems    DocumentRequestItem[]

  @@index([tenantId, clientId])
  @@index([tenantId, caseId, isCurrent])
}
```

### Communications: calls, SMS, email, campaigns

```prisma
model CallLog {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  branchId        String?  @db.Uuid
  agentUserId     String   @db.Uuid
  leadId          String?  @db.Uuid
  clientId        String?  @db.Uuid
  direction       CallDirection
  fromNumber      String
  toNumber        String
  twilioSid       String   @unique
  status          String                 // queued/ringing/in-progress/completed/no-answer/failed/busy
  startedAt       DateTime
  answeredAt      DateTime?
  endedAt         DateTime?
  durationSeconds Int?
  recordingUrl    String?
  recordingDuration Int?
  disposition     String?                // INTERESTED, NOT_REACHABLE, FOLLOWUP, etc.
  notes           String?

  @@index([tenantId, agentUserId, startedAt])
  @@index([tenantId, leadId])
}

enum CallDirection { INBOUND OUTBOUND }

model SmsLog {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String   @db.Uuid
  agentUserId String?  @db.Uuid
  toNumber    String
  body        String
  twilioSid   String   @unique
  status      String
  sentAt      DateTime @default(now())
}

model EmailLog {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String   @db.Uuid
  toEmail     String
  subject     String
  templateId  String?
  providerId  String?  @unique
  status      String
  sentAt      DateTime @default(now())
}

model Campaign {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String   @db.Uuid
  name        String
  channel     CampaignChannel
  template    String
  filters     Json
  scheduledAt DateTime?
  status      String                  // DRAFT, RUNNING, DONE
  stats       Json?                   // {sent, delivered, opened, clicked, replied}
  createdAt   DateTime @default(now())
}

enum CampaignChannel { SMS EMAIL CALL }

model LeadCampaign {
  campaignId  String @db.Uuid
  leadId      String @db.Uuid
  sentAt      DateTime?
  status      String?
  @@id([campaignId, leadId])
}
```

### Billing: SaaS seats + firm→client invoices

```prisma
model SubscriptionInvoice {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  stripeInvoiceId String   @unique
  amountCents     BigInt
  currency        String
  periodStart     DateTime
  periodEnd       DateTime
  seatCount       Int
  status          String
  pdfUrl          String?
  createdAt       DateTime @default(now())
}

model Invoice {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  caseId          String?  @db.Uuid
  clientId        String   @db.Uuid
  invoiceNumber   String                       // INV-2026-000123
  totalCents      BigInt
  paidCents       BigInt   @default(0)
  currency        String   @default("CAD")
  status          InvoiceStatus @default(DRAFT)
  dueDate         DateTime?
  pdfUrl          String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  items           InvoiceItem[]
  payments        Payment[]

  @@unique([tenantId, invoiceNumber])
  @@index([tenantId, clientId])
}

enum InvoiceStatus { DRAFT SENT PARTIAL PAID OVERDUE VOID }

model InvoiceItem {
  id          String @id @default(dbgenerated("uuidv7()")) @db.Uuid
  invoiceId   String @db.Uuid
  invoice     Invoice @relation(fields: [invoiceId], references: [id])
  description String
  quantity    Int    @default(1)
  unitCents   BigInt
  totalCents  BigInt
}

model Payment {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  invoiceId       String   @db.Uuid
  amountCents     BigInt
  method          String                       // CARD, ETRANSFER, CASH, CHEQUE
  stripePaymentIntent String?
  receivedAt      DateTime
  recordedBy      String?  @db.Uuid
}
```

### E-sign

```prisma
model Retainer {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  caseId          String   @db.Uuid @unique
  documentHtml    String
  documentPdfUrl  String?
  status          RetainerStatus @default(DRAFT)
  sentAt          DateTime?
  signedAt        DateTime?
  signerName      String?
  signerEmail     String?
  signerIp        String?
  signatureSvg    String?                       // captured signature
  auditTrail      Json                          // [{event, timestamp, ip, ua}]
  createdAt       DateTime @default(now())
}

enum RetainerStatus { DRAFT SENT VIEWED SIGNED DECLINED EXPIRED }
```

### Client portal

```prisma
model ClientPortalAccount {
  id              String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId        String   @db.Uuid
  clientId        String   @db.Uuid @unique
  email           String
  passwordHash    String?
  magicLinkSentAt DateTime?
  twoFAEnabled    Boolean  @default(false)
  twoFASecret     String?
  isActive        Boolean  @default(true)
  lastLoginAt     DateTime?
  createdAt       DateTime @default(now())

  @@unique([tenantId, email])
}
```

## Required Postgres extensions

- `uuid-ossp` or `pg_uuidv7` (uuidv7 default)
- `pgcrypto` (column encryption helpers)
- `pg_trgm` (full-text search on names)
- `citext` (case-insensitive emails)

## Critical indexes (call out for review)

- `Client(tenantId, phone)` UNIQUE — enforces "phone = primary client key"
- `Case(tenantId, status)` — case board / kanban queries
- `CallLog(tenantId, agentUserId, startedAt)` — telecaller KPI dashboards
- `Lead(tenantId, status)` partial WHERE status IN ('NEW','FOLLOWUP') — fast queue
- `Document(tenantId, caseId, isCurrent)` partial WHERE isCurrent — current versions only

## Migration policy

- Every schema change is a numbered Prisma migration committed in the same PR as the code that uses it.
- Destructive migrations (drop column, type change) are split into expand → migrate data → contract across two deploys.
- `pnpm db:check` on CI runs `prisma migrate diff` to ensure no drift.

## Resume checkpoint for this doc

When you sit back down: open `packages/db/schema.prisma`. If a model in this doc isn't there yet, that's the next thing to scaffold for the relevant phase.
