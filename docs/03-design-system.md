# 03 — Design System

Defines look-and-feel, component inventory, layout patterns, dropdown rules, and responsive behavior. Every screen in any phase doc inherits from here.

## Themes (6 presets + custom)

Stored in `packages/config/themes.ts`. Tenant picks one in Phase 1 setup wizard; can override later in Settings → Branding.

| # | Name | Use case | Primary | Accent | Background | Surface | Text |
|---|------|----------|---------|--------|------------|---------|------|
| 1 | **Maple** (default CA) | warm, trust | `#B5132B` | `#1F2937` | `#FAFAF7` | `#FFFFFF` | `#111827` |
| 2 | **Glacier** | clean corporate | `#1E40AF` | `#0EA5E9` | `#F8FAFC` | `#FFFFFF` | `#0F172A` |
| 3 | **Forest** | calm, professional | `#15803D` | `#65A30D` | `#F7FAF7` | `#FFFFFF` | `#0F1F12` |
| 4 | **Slate** | minimal mono | `#0F172A` | `#64748B` | `#F1F5F9` | `#FFFFFF` | `#0F172A` |
| 5 | **Aurora** | modern, vibrant | `#7C3AED` | `#22D3EE` | `#FAFAFC` | `#FFFFFF` | `#1E1B4B` |
| 6 | **Midnight** (dark) | dark mode | `#60A5FA` | `#A78BFA` | `#0B1220` | `#111827` | `#E5E7EB` |
| C | **Custom** | per tenant | user-picked | derived | derived | derived | auto-contrast |

### Theme tokens

Each theme exposes the same token set so components don't care which theme is active:

```ts
type ThemeTokens = {
  color: {
    bg: string; surface: string; surfaceMuted: string;
    border: string; borderMuted: string;
    text: string; textMuted: string; textOnPrimary: string;
    primary: string; primaryHover: string; primaryActive: string;
    accent: string;
    success: string; warning: string; danger: string; info: string;
    focus: string;
  };
  radius: { sm: 4; md: 8; lg: 12; xl: 16; pill: 9999 };
  shadow: { sm: string; md: string; lg: string };
  font: { sans: string; mono: string };
};
```

For **Custom**, the tenant picks a primary hex. The system derives:
- `primaryHover` = primary darken 8%
- `primaryActive` = primary darken 14%
- `textOnPrimary` = white if WCAG contrast > 4.5 against primary, else `#111827`
- `accent` = analogous +30° hue shift

## Typography

- Sans: `Inter` (variable, self-hosted woff2). Fallback: `system-ui`.
- Mono: `JetBrains Mono` (only used for code blocks, audit log JSON, IDs).
- Scale (rem): `xs 0.75 / sm 0.875 / base 1 / lg 1.125 / xl 1.25 / 2xl 1.5 / 3xl 1.875 / 4xl 2.25`.
- Line height: body 1.55, headings 1.2.
- Headings use weight 600; body 400; emphasized labels 500. No 700 except for landing pages.

## Spacing & layout

- 4px base unit. Tailwind defaults. No magic numbers — always `p-2`, `gap-4`, etc.
- Page max width: dashboards `max-w-screen-2xl` (1536px); content/portal `max-w-3xl`.
- Side nav: 240px expanded, 64px collapsed.
- Top bar: 56px tall.
- Section padding (dashboard): `px-6 py-6` desktop, `px-4 py-4` mobile.

## Layout patterns

### A. Staff dashboard shell (used in every phase ≥ 2)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ☰  [Logo] OnsecBoad                  🔍 Search Cmd+K   🔔  [Avatar ▼]    │  ← top bar (56px)
├────┬─────────────────────────────────────────────────────────────────────┤
│ N  │  Breadcrumb: Dashboard › Cases › Case ON-2026-00123                 │
│ A  │ ─────────────────────────────────────────────────────────────────── │
│ V  │                                                                     │
│    │   <Page content here>                                               │
│ S  │                                                                     │
│ I  │                                                                     │
│ D  │                                                                     │
│ E  │                                                                     │
│    │                                                                     │
│240 │                                                                     │
│px  │                                                                     │
└────┴─────────────────────────────────────────────────────────────────────┘
```

**Top-right Avatar dropdown [▼]** opens DOWN-LEFT (origin: top-right of trigger), 280px wide, contains:
- Profile photo + name + role
- "My profile"
- "My calendar" (lawyers/consultants only)
- "Switch branch" (multi-branch managers only)
- "Settings"
- divider
- "Help & support"
- "Sign out"

**Notification bell 🔔** opens DOWN-LEFT, 360px wide, list of 10 latest with "Mark all read" footer. Realtime via WebSocket.

**Search Cmd+K** opens centered modal (cmd-bar), searches across leads/clients/cases/users, scoped to tenant + branch.

### B. Side nav (per role)

Items appear/hide based on RBAC. Order is fixed:

```
Onsective Platform Manager:
  • Dashboard
  • Law Firms
  • Billing & Plans
  • Platform Users
  • Audit Log
  • System Health
  • Settings

Law Firm Admin:
  • Dashboard
  • Leads
  • Clients
  • Calendar
  • Cases
  • Documents
  • Invoices
  • CRM Campaigns
  • Reports
  • ─────────────
  • Branches
  • Users & Roles
  • Masters (intake forms, doc checklists, case types, fees)
  • Settings (branding, integrations, billing)

Branch Manager: same as admin minus Branches/Users-create across branches; data scoped to branch.

Lawyer:
  • Dashboard
  • My Calendar
  • My Cases (review queue)
  • Clients
  • Documents

Consultant:
  • Dashboard
  • My Calendar
  • My Cases
  • Clients
  • Documents

Filer / Case Manager:
  • Dashboard
  • My Cases
  • Document Requests
  • Clients

Telecaller:
  • Dashboard
  • My Leads (queue)
  • Call History
  • Campaigns (read-only)

Receptionist:
  • Dashboard
  • Today's Appointments
  • Walk-ins
  • Client Lookup
```

### C. Client portal shell

Simpler — no side nav. Top tabs: Overview · Documents · Payments · Messages · Profile. Logo top-left, language switcher + sign-out top-right.

## Component inventory (built on shadcn/ui)

Lives in `packages/ui/`. Each component supports all 6 themes via tokens.

| Component | Notes |
|---|---|
| `Button` | variants: primary, secondary, ghost, danger, link; sizes: sm/md/lg/icon |
| `Input` | text, number, search, password (with reveal toggle) |
| `Textarea` | autoresize option |
| `Select` (Radix) | searchable variant `SelectSearch` for >10 options |
| `Combobox` | for client/lead lookups with async fetch |
| `MultiSelect` | tag-style, used for permissions, languages |
| `DatePicker` / `DateRangePicker` | uses tenant timezone |
| `TimePicker` | 24h with locale toggle |
| `Switch`, `Checkbox`, `RadioGroup` | |
| `FileUpload` | drag/drop, multi, virus-scan hook (ClamAV optional) |
| `PhoneInput` | E.164, country-code selector defaulting to CA |
| `MoneyInput` | locale-aware, cents-internal |
| `Badge` | status pill — one variant per CaseStatus |
| `Tabs`, `Accordion`, `Tooltip`, `Popover`, `Dialog`, `Drawer`, `Sheet`, `Toast` | Radix primitives |
| `DataTable` | TanStack Table; pagination, server-side sort/filter, column visibility, density |
| `KanbanBoard` | columns by status; used for cases & leads |
| `Calendar` | month/week/day views; FullCalendar wrapped |
| `Avatar`, `AvatarGroup` | |
| `EmptyState` | icon + title + description + CTA |
| `Skeleton` | for loading; never spinners on lists |
| `ErrorBoundary` | fallback UI + Sentry report |
| `ConfirmDialog` | destructive action confirmation with typed-name match for hard deletes |

## Dropdown / menu rules

- All dropdowns built on Radix `DropdownMenu` or `Select`.
- **Position rule**: open in the direction with most viewport room. Default DOWN. Flip UP if bottom < 200px. Align: start (left) by default; end (right) if trigger is right-anchored.
- **Width**: match trigger width for `Select`; auto-width capped at 320px for action menus.
- **Z-index**: 50 for popovers, 60 for dialogs, 70 for toasts.
- **Keyboard**: arrow keys cycle, Enter selects, Esc closes, typing focuses matching item.
- **Scroll lock**: only for full-screen dialogs, not for menus.
- **Click outside / blur**: dismiss.

### Common dropdown locations to remember

| Where | Trigger | Direction | Items |
|---|---|---|---|
| Top bar avatar | top-right | down-left | profile, settings, sign out (full list above) |
| Top bar bell | top-right | down-left | notifications |
| Top bar branch picker | top-left next to logo | down-right | branches user has access to |
| Row action `•••` in tables | end of row | down-end | View / Edit / ... / Delete |
| Status pill in case header | inline | down-start | available next states (governed by state machine) |
| Filter button on data tables | above table, left | down-start | Status / Branch / Assignee / Date range |
| Bulk action bar | floating bottom-center when rows selected | up-center | Assign / Tag / Export / Delete |
| Calendar event click | inline popover | flip | Reschedule / Cancel / Mark arrived / Open client |
| Text editor toolbar | top of editor | down-start | font/list/link |

## Forms

- Always use `react-hook-form` + `zod` resolver.
- Field layout: label above input; helper text below in `text-xs text-textMuted`; error in `text-xs text-danger`.
- Required fields: `*` after label; not in placeholder.
- Long forms (>10 fields): vertical stepper on left in dialog/page; per-step validation.
- Auto-save drafts every 5s for forms > 5 fields (intake, retainer drafts, case notes). Show "Saved" indicator.
- Submit button: primary, full-width on mobile, right-aligned on desktop. Disable + spinner during submit.

## States

| State | Pattern |
|---|---|
| Empty | `EmptyState` component with friendly illustration, 1-line description, primary CTA |
| Loading | Skeletons matching the final layout. Never spinners except for inline buttons. |
| Error | Inline alert with retry button; full-page error boundary for crashes |
| Partial / stale | "Last updated 3m ago — Refresh" small label, top-right of card |

## Notifications & toasts

- Toast positions: bottom-right desktop, top-center mobile.
- Auto-dismiss: success 3s, info 5s, warning 7s, error sticky until dismissed.
- Real-time push (in-app): WebSocket channel per user; bell increments + sound (mutable).
- OS push (mobile/desktop PWA): for high-priority only (assigned a case, deadline 24h, retainer signed).

## Accessibility

- WCAG 2.1 AA minimum. Custom themes auto-validate contrast at theme-save time and reject below 4.5:1 for body text.
- All interactive elements keyboard reachable; focus ring visible (`outline-2 outline-focus offset-2`).
- ARIA labels on icon-only buttons.
- Reduced motion: respect `prefers-reduced-motion`; disable transitions if set.
- Tested with VoiceOver, NVDA. Documented manual test plan in `04-security-and-compliance.md` (see acceptance phase).

## Mobile / TV considerations

- All layouts responsive: side nav becomes bottom nav on `< md`. Drawer for full nav.
- Touch targets ≥ 44×44 px.
- Tables collapse to cards on `< md`.
- TV (Phase 9): 10-foot UI; large fonts (1.5x scale), focus ring 4px, D-pad navigation order explicit per screen.

## Performance budgets (UI)

- First Contentful Paint < 1.5s on 3G Fast.
- Largest Contentful Paint < 2.5s.
- CLS < 0.1.
- INP < 200ms.
- JS shipped per route < 200KB gzip.
- Images: AVIF/WebP, `next/image` everywhere. Logos as inline SVG.

## Internationalization

- Day-1 locales: `en-CA`, `fr-CA` (legal requirement to be ready for FR even if launch is EN-only).
- Future: `pa` (Punjabi), `hi` (Hindi), `zh-CN`, `tl` (Tagalog) — large prospect pools.
- Library: `next-intl`; messages co-located with route segments.
- Currency, dates, numbers via `Intl.*` APIs always — no manual formatting.

## Iconography

- `lucide-react` only. No Font Awesome. No mixed icon libraries.
- Standard sizes: 16, 20, 24px. Match surrounding text size.

## Visual examples (refer back from phase docs)

A "primary action button at top-right of a card header" looks like:

```
┌──────────────────────────────────────────────────────────────┐
│ Card Title                                       [+ New ▼]  │  ← dropdown opens DOWN-LEFT
├──────────────────────────────────────────────────────────────┤
│ ...content...                                                │
└──────────────────────────────────────────────────────────────┘
```

A row-level `•••` actions menu in a data table:

```
┌─────────────────────────────────────────────────────────┐
│ Name           Status    Assigned     Updated   Action  │
├─────────────────────────────────────────────────────────┤
│ John D.        Pending   Sara L.      2h        [ ••• ] │  ← opens DOWN-END
│                                                  ┌──────┴──┐
│                                                  │ Open    │
│                                                  │ Reassign│
│                                                  │ ───     │
│                                                  │ Delete  │
│                                                  └─────────┘
└─────────────────────────────────────────────────────────┘
```

## Resume checkpoint for this doc

When picking up: confirm `packages/ui/` exposes all components in the inventory above. If any are missing for the phase you're working on, add them before continuing.
