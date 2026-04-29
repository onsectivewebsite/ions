# OnsecBoad Mobile

Three Expo apps from one codebase:

- **Staff** — leads, calls, cases on the go.
- **Client** — mirror of the web client portal.
- **TV** — branch lobby display (today's appointments + walk-ins).

## Quick start

```sh
pnpm install                                      # at the repo root
pnpm --filter @onsecboad/mobile start:staff       # or start:client / start:tv
```

The variant is picked at start time via the `APP_VARIANT` env var. Each
build target gets its own bundle id, slug, and EAS profile (see
`eas.json`).

## Structure

```
src/
├── apps/
│   ├── staff/        # entry + screens for the staff variant
│   ├── client/       # placeholder (Phase 9.2)
│   └── tv/           # placeholder (Phase 9.3)
└── shared/
    ├── api.ts        # tRPC over fetch (matches apps/web pattern)
    ├── session.ts    # expo-secure-store wrapper
    └── theme.ts      # mobile theme tokens (sourced from @onsecboad/config/themes)
```

## Phase 9.1 status

- [x] Expo skeleton (3 variants, EAS profiles)
- [x] Staff: email/password + 2FA email OTP sign-in
- [x] Staff: dashboard with cases / queue counts
- [ ] Client app — Phase 9.2
- [ ] TV app — Phase 9.3
- [ ] Push notifications — Phase 9.4

## Building

EAS profiles are pre-defined in `eas.json`:

```sh
APP_VARIANT=staff  eas build --profile preview --platform all
APP_VARIANT=client eas build --profile preview-client --platform all
APP_VARIANT=tv     eas build --profile preview-tv --platform all
```

Bundle ids in `app.config.ts` are placeholders (`cloud.onsective.*`) —
swap to Onsective's real Apple/Google accounts before TestFlight / Play
submission.
