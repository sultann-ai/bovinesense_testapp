# Bovine Track — BOP Dashboard

> **Always read `docs/DESIGN.md` fully before any UI work.** It is the single source of truth for design tokens, component specs, and scope.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) |
| Styling | Tailwind CSS v4 |
| UI primitives | Radix UI (dropdown, select, tooltip, avatar, separator) |
| Icons | Lucide React — outline, 1.5 px stroke, 20 px UI / 16 px tables |
| Fonts | Inter (UI) · IBM Plex Mono (IDs, coordinates, loan numbers) |
| State | React `useState` / context (no external store yet) |

## Folder structure

```
src/
  app/                   # Next.js App Router
    layout.tsx           # Root layout — wires Sidebar + TopBar + DemoModeBanner
    page.tsx             # Overview (P0)
    alerts/page.tsx      # Alerts (P0)
    animals/page.tsx     # Animals (P0)
    geofences/page.tsx   # Geofences (P0)
    borrowers/page.tsx   # Borrowers & Loans (P1 — coming soon)
    reports/page.tsx     # Reports (P1 — coming soon)
    devices/page.tsx     # Devices (P1 — coming soon)
    settings/page.tsx    # Settings (P2 — coming soon)
    globals.css          # All CSS variables + @theme block
  components/
    shell/
      Sidebar.tsx        # Collapsible left rail (240/72 px)
      TopBar.tsx         # 64 px top bar with search, selectors, user menu
      DemoModeBanner.tsx # Gold-bordered demo strip
      ComingSoon.tsx     # Empty state for P1/P2 screens
  lib/
    utils.ts             # cn() helper (clsx + tailwind-merge)
docs/
  DESIGN.md              # ← SOURCE OF TRUTH — read before any UI work
```

## Design token rules

- **Never hardcode hex values** in components. Always use CSS variables.
- All tokens are defined in `src/app/globals.css` under `:root`.
- Tailwind v4 theme lives in the `@theme inline` block in the same file.
- Token naming: `--bg-*` backgrounds · `--text-*` text · `--border` · `--brand*` brand · `--highlight` accent · `--status-*` semantic status only.
- **Brand tokens and status tokens stay separate.** Terracotta (`--brand`) is for navigation and CTAs. Breaches use `--status-breach` (crimson), never `--brand`.

## Typography rules

- UI text: `font-family: var(--font-ui)` (Inter loaded via `--font-inter` CSS variable)
- IDs, coordinates, loan numbers: `font-family: var(--font-mono)` + `font-variant-numeric: tabular-nums` → use class `font-mono-ids`
- Numbers in columns: add class `tabular-nums`
- Type scale from §4 of DESIGN.md: page-title 24/32/600, section-title 18/26/600, KPI 32/36/600, body 14/20/400, small 13/18/400, label 12/16/500 uppercase +0.04em, mono 13/18/400

## Spacing & radius

- Base 4 px; only steps 4, 8, 12, 16, 24, 32, 48 permitted.
- Radius: `--radius-sm` 6 px (inputs/chips), `--radius-md` 10 px (cards), `--radius-lg` 14 px (drawers/modals), `--radius-full` (pills).
- Cards: flat, 1 px `--border`. Floating elements (over map): `--shadow-float`.

## Roles

The user menu carries a role switcher: HQ admin · regional manager · branch officer · auditor.
Role state is currently local (`useState`). Wire to auth context when adding real auth.

## Demo mode

The `DemoModeBanner` shows under the top bar at all times:
> "Demo environment: 1 live tag, 240 simulated animals."
Do not hide it. It protects credibility in client demos.

## Adding new screens

1. Add a folder under `src/app/<route>/page.tsx`
2. Add the nav item to the `NAV_ITEMS` array in `src/components/shell/Sidebar.tsx`
3. Read §3 and §4 of DESIGN.md for token reference before writing any styling
