# Phase 9 — Mobile (Staff + Client) and TV (Branch Lobby)

> **Goal:** Three native apps from one Expo codebase: staff (case alerts, calls, calendar, notes on the go), client (mirror of portal), TV (branch lobby display: today's appointments, queue, brand).
>
> **Done when:** All three apps install on TestFlight / Play internal track / Apple TV; staff app supports passkey + biometric unlock; client app supports magic-link + biometric; TV app autoplays on a smart TV plugged in at a branch and updates in real time.

## Repo structure

```
apps/mobile/
├── app.config.ts
├── src/
│   ├── apps/
│   │   ├── staff/        # entry, screens
│   │   ├── client/
│   │   └── tv/
│   ├── shared/           # tRPC client, theme, components
│   └── theming/
└── eas.json              # build profiles (staff/client/tv × dev/preview/prod)
```

Three Expo apps share `apps/mobile/src/shared` via per-app entries — different `app.json` slugs, bundle IDs, and EAS profiles.

## Bundle ids (placeholder — replace in EAS)

- Staff: `com.onsective.onsecboad.staff`
- Client: `com.onsective.onsecboad.client`
- TV: `com.onsective.onsecboad.tv`

## Auth on mobile

- **Staff**: same flow as web (password / passkey via expo-passkeys + 2FA). Add biometric unlock for already-signed-in sessions (FaceID/TouchID/Android biometric).
- **Client**: magic link (deep link `onsecboad://portal/sign-in?token=...`), biometric unlock thereafter.
- **TV**: device pairing model — branch manager visits `/f/branches/[id]/devices/pair`, gets a 6-digit code, types into TV app; TV gets a long-lived **kiosk token** scoped only to read today's queue.

## Staff app — features

- Push notifications (Expo push) for: new lead assigned, retainer signed, lawyer review request, deadline T-24h, agent action taken.
- Case list (mine), case detail (read + add notes + upload doc from camera).
- Click-to-call via Twilio Programmable Voice (mobile SDK).
- Calendar (today + week views).
- Quick capture: photo of a passport → auto-classify (Phase 8) and attach to selected case.
- Offline-light: cache last 50 cases + last 100 docs metadata; queued mutations replay on reconnect.

### Wireframe — Staff home

```
┌──────────────────────────────┐
│ ☰  OnsecBoad         🔔  👤  │
├──────────────────────────────┤
│ Today                        │
│  📅 3 appts · 8 tasks · 2 ⚠  │
├──────────────────────────────┤
│ My cases (12)                │
│ ┌────────────────────────┐   │
│ │ WP-2026-00123  John D. │   │
│ │ Pending Documents      │   │
│ │ Last update 2h         │   │
│ └────────────────────────┘   │
│ ┌────────────────────────┐   │
│ │ SP-2026-00098  Lily Z. │   │
│ │ Lawyer Review          │   │
│ └────────────────────────┘   │
├──────────────────────────────┤
│ [📸 Quick capture]           │
├──────────────────────────────┤
│ 🏠   📋   📞   📅   ⚙       │  ← bottom tab bar
└──────────────────────────────┘
```

### Wireframe — case detail (mobile)

```
┌──────────────────────────────┐
│ ← Back                       │
│ WP-2026-00123                │
│ John D.   Toronto Main       │
├──────────────────────────────┤
│ Status [▼ Pending Docs]      │  ← bottom-sheet on tap
├──────────────────────────────┤
│ [Overview][Docs][Notes][💵]  │
├──────────────────────────────┤
│ ...                          │
│                              │
│ [+ Add note]   [📸 Add doc]  │  ← FAB-ish bottom row
└──────────────────────────────┘
```

## Client app — features

- Magic-link onboarding (universal link).
- Status timeline.
- Document upload (camera + library + Files); shows checklist completion.
- Pay invoice (Stripe React Native SDK).
- In-app messaging with firm.
- Push notifications: payment received, document received, status changed, message from firm, decision update.

### Wireframe — client home

```
┌──────────────────────────────┐
│ [Firm logo]       👤          │
├──────────────────────────────┤
│ Hi John 👋                   │
│ Your case: Work Permit       │
│ Status: ⓘ Pending Documents  │
│                              │
│ Progress                     │
│ ●━━━●━━━○━━━○━━━○             │
│                              │
│ Outstanding: CAD $3,500      │
│ [ Pay an installment ]       │
│                              │
│ Next steps                   │
│ • Upload IELTS scorecard     │
│ • Upload job offer letter    │
│ [ Upload documents → ]       │
├──────────────────────────────┤
│ 🏠 📂 💵 💬 ⚙                │
└──────────────────────────────┘
```

## TV app (tvOS / Android TV / web kiosk fallback)

Single full-screen view; auto-refreshes every 60s; no inputs except branding.

### Wireframe — Lobby display

```
┌────────────────────────────────────────────────────────────────────────────┐
│  [Firm logo]                                       Acme Immigration         │
│  Toronto Main Branch                                Wed, 26 Apr · 14:21    │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  Now serving                                                               │
│   • John D.        with Anna K. (Lawyer)         Booth 2                   │
│   • Priya S.       with Sara L. (Consultant)     Booth 4                   │
│                                                                            │
│  Up next                                                                   │
│   1. Mark T.       at 14:30 with Anna K.                                   │
│   2. Lily Z.       at 14:45 with Sara L.                                   │
│   3. Eric P.       at 15:00 with Anna K.                                   │
│                                                                            │
│  [QR code]  Walk-in? Scan to fill our intake form.                          │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

10-foot UI: large fonts (≥ 32pt body), high contrast, no interaction needed. D-pad (if present) only navigates a small "Settings" gear in the corner that re-pairs the device.

## API surface (additions)

```
device.pair.start({branchId})                  → {code, expiresInSec}
device.pair.complete({code})                   → {kioskToken}
device.kiosk.lobby({branchId, token})          → LobbyPayload    (today's appts + now serving + up next)

push.register({token, platform})               → ok
push.unregister({token})                       → ok
notif.list({page})                             → Notification[]
notif.markRead({ids})                          → ok
```

## Database changes

```prisma
model Device {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String   @db.Uuid
  branchId    String?  @db.Uuid
  kind        DeviceKind                       // STAFF_MOBILE | CLIENT_MOBILE | TV_LOBBY
  platform    String                            // ios|android|tvos|atv|webkiosk
  pushToken   String?
  kioskTokenHash String?                        // for TV
  pairedBy    String?  @db.Uuid
  pairedAt    DateTime?
  lastSeenAt  DateTime?
  revokedAt   DateTime?
}
enum DeviceKind { STAFF_MOBILE CLIENT_MOBILE TV_LOBBY }

model Notification {
  id          String   @id @default(dbgenerated("uuidv7()")) @db.Uuid
  tenantId    String   @db.Uuid
  userId      String?  @db.Uuid
  clientId    String?  @db.Uuid
  kind        String                             // case.assigned | retainer.signed | ...
  title       String
  body        String
  link        String?
  payload     Json?
  readAt      DateTime?
  createdAt   DateTime @default(now())
  @@index([tenantId, userId, readAt])
}
```

## Background jobs

| Job | Purpose |
|---|---|
| `push-send` | Send Expo push when a notification is created for a user with a registered device |
| `device-cleanup` | Revoke devices not seen in 90 days |
| `lobby-snapshot` | Pre-compute lobby payload per branch every 30s and cache (TVs poll cached) |

## CRUD matrix

| Entity | Action | Onsective | FirmAdmin | BranchMgr | Staff | Client |
|---|---|---|---|---|---|---|
| Device (TV pair) | C/D | ✓ | ✓ | ✓ (own branch) | — | — |
| Device (own mobile) | C/R/D | ✓ | ✓ | ✓ | ✓ | ✓ |
| Notification | R/U own | ✓ | ✓ | ✓ | ✓ | ✓ |

## Debug / observability

- Push delivery: Expo response logged per send; failure retries.
- Device "last seen" updated on each authed request; expired/revoked devices return 401.
- TV kiosk token has its own scope (read-only for `device.kiosk.*`); leak doesn't expose more.
- Staff offline queue: persist mutations to AsyncStorage; replay on reconnect; idempotency keys to avoid duplicates.

## Performance budget

- App cold start < 2s on iPhone 12 / Pixel 6.
- Lobby refresh < 200ms server-side (cached).
- Push delivery time p95 < 5s after event.

## Acceptance criteria

- [ ] Staff app installs via TestFlight + Play internal; passkey login works
- [ ] Camera capture → upload → auto-classify (Phase 8) end-to-end on mobile
- [ ] Client app receives a payment-received push within 10s after Stripe webhook
- [ ] TV pairing via 6-digit code; kiosk token scoped; revoke disconnects within 60s
- [ ] Lobby auto-refreshes; appts within ±2 min of real time
- [ ] App store metadata + screenshots prepared per app
- [ ] Universal/app links configured (Apple AASA, Android Asset Links) for magic-link login
- [ ] Theme matches each tenant's branding (re-fetched on launch + on tenant config update)

## Resume checkpoint

```
apps/mobile/                                    ← Expo monorepo
   src/apps/staff/, src/apps/client/, src/apps/tv/
   src/shared/api.ts                            ← tRPC client (mobile-aware fetch)
   src/shared/theme/                            ← reads tenant branding
packages/jobs/pushSend.ts, lobbySnapshot.ts
packages/db/schema.prisma                       ← Device, Notification
infra/expo-eas/                                 ← EAS build/secrets/profiles
```

Sit-back-down test: pair a TV (or open the web kiosk fallback on a laptop), book an appointment for "now + 30 min" on a branch — within 60s the upcoming list should reorder. If not → check `lobby-snapshot` cache invalidation.
