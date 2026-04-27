# Phase 2 — Roles, Branches & User Management

> **Goal:** Firm Admin can build the org: create branches, assign branch managers, invite users with roles, see audit, and have seat count auto-sync to Stripe.
>
> **Done when:** A new Firm Admin sets up 2 branches, invites 1 manager + 3 staff (with different roles) per branch, and within minutes Stripe shows `seatCount = 8` and each invitee has signed in successfully.

## Routes

| URL | Who | What |
|---|---|---|
| `/f/branches` | FirmAdmin | branch list with stats |
| `/f/branches/new` | FirmAdmin | create branch |
| `/f/branches/[id]` | FirmAdmin or that BranchMgr | branch detail |
| `/f/branches/[id]/edit` | FirmAdmin | edit |
| `/f/users` | FirmAdmin | all users |
| `/f/users/new` | FirmAdmin | invite user |
| `/f/users/[id]` | FirmAdmin | user detail (role, branch, status, audit) |
| `/f/branches/[id]/users` | BranchMgr | branch-scoped users |
| `/f/roles` | FirmAdmin | role + permissions matrix editor |
| `/f/audit` | FirmAdmin | audit viewer (own tenant) |
| `/invite/[token]` | invitee | accept invite, set password, enroll 2FA |

## Roles (system defaults; new custom roles allowed)

| Code | Default permissions (high-level) |
|---|---|
| `FIRM_ADMIN` | everything firm-wide |
| `BRANCH_MANAGER` | everything in own branch except billing & branding |
| `LAWYER` | calendar, cases (review/approve), clients, documents (read+approve), retainers (approve) |
| `CONSULTANT` | calendar, cases (filer ops + consultations), clients, documents R/W |
| `FILER` | cases (own only), document requests, clients (read), upload docs |
| `CASE_MANAGER` | cases (assigned), retainer send, document requests, client comms |
| `TELECALLER` | leads (own queue), call/SMS via Twilio, campaigns (read) |
| `RECEPTIONIST` | today's appointments, walk-ins, client lookup, mark arrived |

Permission JSON shape (stored on `Role.permissions`):

```json
{
  "leads":     {"read": "branch", "write": "own", "delete": false},
  "clients":   {"read": "branch", "write": "branch", "delete": false},
  "cases":     {"read": "branch", "write": "assigned", "delete": false},
  "documents": {"read": "case",   "write": "case",   "delete": "admin"},
  "billing":   {"read": false,    "write": false,    "delete": false},
  "settings":  {"read": false,    "write": false,    "delete": false},
  "calls":     {"read": "own",    "write": "own",    "delete": false},
  "campaigns": {"read": "branch", "write": false,    "delete": false}
}
```

Scopes: `false | own | assigned | case | branch | tenant`. Resolution order: explicit role grant > role default > deny.

## API surface

```
branch.list({page, q})                         → paginated
branch.get({id})                               → Branch + stats
branch.create(input)                           → Branch
branch.update({id, ...})                       → Branch
branch.archive({id})                           → ok
branch.assignManager({id, userId})             → Branch

user.list({page, q, branchId, roleId, status}) → paginated
user.get({id})                                 → User
user.invite(input)                             → {userId, inviteUrl}
   input: { email, name, phone?, branchId?, roleId, isBillable }
user.resendInvite({id})                        → ok
user.update({id, ...})                         → User
user.disable({id})                             → User
user.enable({id})                              → User
user.delete({id})                              → ok    // soft delete; releases seat
user.changeRole({id, roleId})                  → User
user.changeBranch({id, branchId})              → User

role.list()                                    → Role[]
role.get({id})                                 → Role
role.create(input)                             → Role
role.update({id, name?, permissions?})         → Role
role.delete({id})                              → ok    // blocked if any user has it

invite.preview({token})                        → {tenantName, role, email}
invite.accept({token, password, twoFAMethod})  → {accessToken}

audit.list({page, filters})                    → paginated
```

## Database changes

- All P0 tables already cover this. Activate `branch.managerId`.
- Add `Invite` table to track pending invites cleanly:
  ```prisma
  model Invite {
    id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
    tenantId    String   @db.Uuid
    email       String
    roleId      String   @db.Uuid
    branchId    String?  @db.Uuid
    invitedBy   String   @db.Uuid
    tokenHash   String   @unique
    expiresAt   DateTime
    acceptedAt  DateTime?
    @@index([tenantId, email])
  }
  ```

## Background jobs

| Job | Trigger |
|---|---|
| `invite-send` | After `user.invite` |
| `invite-expire` | Cron daily, expire 7-day-old invites |
| `seat-sync` | After user create/disable/delete; updates Stripe quantity |

## Wireframes

### `/f/branches`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Branches                                                  [+ New branch] │
├──────────────────────────────────────────────────────────────────────────┤
│ Name              City         Manager       Users   Active cases   ⋯    │
│ Toronto Main      Toronto, ON  Sara L.        12         34         [⋯] │  ← row menu DOWN-END:
│ Calgary Central   Calgary, AB  (unassigned)    3          5         [⋯] │     • Open
│ ...                                                                      │     • Edit
│                                                                          │     • Assign manager
│                                                                          │     • Archive
└──────────────────────────────────────────────────────────────────────────┘
```

### `/f/branches/new`

```
┌──────────────────────────────────────────────────────────────────────────┐
│ New branch                                                               │
├──────────────────────────────────────────────────────────────────────────┤
│ Name *                  [_______________________________]                │
│ Address line 1 *        [_______________________________]                │
│ Address line 2          [_______________________________]                │
│ City *                  [_______________________________]                │
│ Province *              [▼ Ontario                       ]               │  ← DOWN-START
│ Postal code *           [______]                                         │
│ Country                 [▼ Canada                        ]               │
│ Phone                   [+1 ___ ___ ____]                                │
│ Email                   [_______________________________]                │
│                                                                          │
│ Branch manager          [▼ Search user / Invite new      ]               │  ← Combobox; if user not in
│                                                                          │     dropdown, "+ Invite new" opens
│                                                                          │     a side panel
│                                                                          │
│                                              [Cancel] [Create branch]    │
└──────────────────────────────────────────────────────────────────────────┘
```

### `/f/users` — list + invite

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Users (12 / 50)                                          [+ Invite user] │  ← seat counter visible
├──────────────────────────────────────────────────────────────────────────┤
│ [🔍] Branch [▼ All]  Role [▼ All]  Status [▼ All]    Bulk: [▼ Actions]   │
├──────────────────────────────────────────────────────────────────────────┤
│ ☐ Name              Email             Role          Branch    Last seen ⋯│
│ ☐ Sara L.           sara@acme.com    BranchMgr     Toronto   2h         │
│ ☐ Mark P.           mark@acme.com    Filer         Toronto   1d         │
│ ☐ Anna K.           anna@acme.com    Lawyer        Calgary   5m         │
│ ...                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

Bulk dropdown UP-CENTER (floating bar when rows selected): Disable · Enable · Change role · Change branch · Resend invite · Delete

### `/f/users/new` — invite drawer

```
Right-side drawer (480px wide):
┌──────────────────────────────────────┐
│ Invite user                       [×]│
├──────────────────────────────────────┤
│ Email *      [______________________] │
│ Full name *  [______________________] │
│ Phone        [+1 ___ ___ ____]        │
│ Branch       [▼ Toronto Main        ] │  ← required for non-FirmAdmin roles
│ Role *       [▼ Filer               ] │  ← shows role description below
│                                       │
│  ☑ Counts toward seat billing         │
│                                       │
│  An email will be sent to set         │
│  password and 2FA. Link expires       │
│  in 7 days.                           │
│                                       │
│            [Cancel]  [Send invite]    │
└──────────────────────────────────────┘
```

### `/f/roles` — permissions matrix

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Roles & permissions                              [+ New custom role]      │
├──────────────────────────────────────────────────────────────────────────┤
│  Role:  [▼ Filer (default)                                            ] │  ← DOWN-START
│                                                                          │
│  Resource     Read           Write          Delete                       │
│  ─────────────────────────────────────────────────────────────────────── │
│  Leads        [▼ branch]    [▼ own]        [▼ no    ]                    │
│  Clients      [▼ branch]    [▼ branch]     [▼ no    ]                    │
│  Cases        [▼ assigned]  [▼ assigned]   [▼ no    ]                    │
│  Documents    [▼ case]      [▼ case]       [▼ admin ]                    │
│  Billing      [▼ no]        [▼ no]         [▼ no    ]                    │
│  ...                                                                     │
│                                                                          │
│   ⚠ Editing a system role creates a custom override.                     │
│                                                                  [Save] │
└──────────────────────────────────────────────────────────────────────────┘
```

Each [▼] options: no · own · assigned · case · branch · tenant (subset by resource type).

### `/invite/[token]` — accept invite

3-step:
1. Welcome — shows firm logo + invitee name + role
2. Set password (with strength meter) + confirm
3. 2FA: choose TOTP (QR) or Email OTP — must complete before dashboard

## CRUD matrix

| Entity | Action | Onsective | FirmAdmin | BranchMgr | Lawyer/Cons/Filer/Tele/Recept |
|---|---|---|---|---|---|
| Branch | C/U/D | ✓ | ✓ | — | — |
| Branch | R | ✓ | all | own | own |
| User | C (invite) | ✓ | ✓ | ✓ (own branch only) | — |
| User | R | ✓ | tenant | branch | own profile |
| User | U (role/branch) | ✓ | ✓ | branch only, non-FirmAdmin | — |
| User | D | ✓ | ✓ | ✓ (own branch, non-FirmAdmin) | — |
| Role | C/R/U/D | ✓ | ✓ | — | — |
| Audit | R | own tenant | own tenant | own branch | — |

## Debug / observability

- Every role/permission change logs old + new JSON to `AuditLog`.
- Seat sync drift alarm: nightly cron, alert if local count ≠ Stripe quantity.
- Invite accept failures (token expired, mismatch) tracked + alert if > 5/day.
- "Last seen" derived from latest `Session.createdAt` per user, refreshed every 5 min.

## Performance budget

- User list with 1000 users: server-side paginated, p95 < 300ms.
- Permission check on every tRPC call: must add < 5ms (cache role definition in Redis per tenant).

## Acceptance criteria

- [ ] Create branch, assign manager (existing or invite new) — both flows work
- [ ] Invite user → email arrives → accept link → set pw → enroll 2FA → land on dashboard with correct nav for role
- [ ] Disable user → can no longer sign in (existing sessions revoked) → seat count decreases in Stripe within 1 min
- [ ] Branch Manager can only see/manage own branch's users
- [ ] Custom role with denied "billing.read" hides Billing nav item
- [ ] Role permission edit shows audit diff
- [ ] Cross-tenant integration test passes (invite email scoped to tenant)
- [ ] Stripe seat quantity matches active billable users at all times (drift alarm)

## Resume checkpoint

```
apps/web/src/app/(firm)/branches/...
apps/web/src/app/(firm)/users/...
apps/web/src/app/(firm)/roles/...
apps/web/src/app/(firm)/audit/...
apps/web/src/app/invite/[token]/...
packages/auth/rbac.ts        ← scope resolver
packages/jobs/seatSync.ts
packages/db/schema.prisma    ← Invite model added
```

Sit-back-down test: invite a new Filer to a branch. Sign in as that Filer. Side nav should show: Dashboard, My Cases, Document Requests, Clients (per `03-design-system.md`). If wrong nav → RBAC mapping is broken; check `packages/auth/rbac.ts` first.
