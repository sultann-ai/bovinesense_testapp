# Bovine Track — BOP Dashboard Design Language

Oct 8, 2026 · @Muhammad

## 1. The reframe: the bank buys collateral visibility, not a map

Bank of Punjab is not buying animal tracking; it is buying an answer to one daily question: **which financed animals are outside their permitted area, and whose loan is it?** Every design decision below serves that question first and the map second.

What this changes versus the original brief:

- **No world map as the default.** \[Certain\] the financed animals are in Pakistan, so a world view wastes almost every pixel. Open on Punjab; keep a Pakistan button; let zoom-out exist but never land there.
- **Every animal belongs to a borrower, a loan and a branch.** The bank thinks in loan IDs and branches, not tag IDs. Search, filters and alerts must speak the bank's language.
- **"City boundary" means an administrative boundary.** Default each animal's geofence to the borrower's registered district (or tehsil), loaded as real polygons. Hand-drawn circles are the fallback, not the default.
- **Exceptions beat dots.** A bank officer opens this to triage breaches, offline tags and suspicious movement. The alert feed is as important as the map.
- **Honest freshness.** \[Likely\] a standalone GPS tag reports on an interval to save battery, not continuously. The UI must always show "last fix 23 min ago" and never animate movement it does not have.

### Working assumptions

| Assumption | Confidence | Who confirms |
| --- | --- | --- |
| Animals are in Punjab first, Pakistan-wide later | \[Likely\] | BOP |
| BOP structure is region, then branch, then borrower | \[Likely\] | BOP |
| Tag reports a fix every few minutes to hours, not live | \[Likely\] | Hardware team |
| Tag sends over cellular, no gateway needed | \[Certain\], per the GPS-only spec | Hardware team |
| BOP wants its own logo on the screen (co-branded) | \[Guessing\] | BOP |

Working product name used in this doc: **Bovine Track**. Rename freely.

## 2. Information architecture

Build five screens properly for the demo (P0) and stub the rest as navigation items that open a clean "coming soon" state; a bank judges completeness by the menu as much as by the pages.

| Screen | What it answers | Demo priority |
| --- | --- | --- |
| Overview (default) | Where is the fleet right now, and what needs action? Map + KPI strip + live alert feed | P0 |
| Animal detail (right drawer, 420 px) | Where has this animal been, whose loan is it, is the tag healthy? | P0 |
| Alerts | Every breach, offline tag and speed event, with status and owner | P0 |
| Geofences | Which boundary applies to which animals; create and edit zones | P0 |
| Animals | Searchable table of all tagged animals with status and last fix | P0 |
| Borrowers and loans | All animals under one borrower or loan ID | P1 |
| Reports | Daily breach report, offline report, export to PDF and CSV | P1 |
| Devices | Tag inventory: battery, signal, last contact, unassigned tags | P1 |
| Settings | Users, roles, alert rules, SMS and email recipients | P2 |

**Navigation.** A collapsible left rail (240 px open, 72 px collapsed) in charcoal, in this order: Overview, Alerts, Animals, Borrowers, Geofences, Reports, Devices, then Settings pinned to the bottom. The Alerts item carries a live count badge.

**Top bar (64 px).** Bank logo with "Powered by Bovine" on the left; one global search (tag ID, loan ID, borrower name); a region and branch selector that scopes the whole app; the alert bell; the user menu.

**Roles to show in the demo.** HQ admin (all regions), regional manager (one region), branch officer (one branch, can acknowledge and resolve), auditor (read-only). Showing a role switcher in the user menu signals that you understand how a bank is organised.

## 3. Color system

Terracotta is the brand, not an alarm: breaches get their own crimson, always paired with an icon and a word, so an officer never confuses "clickable" with "emergency". The same rule keeps gold out of every status.

### Brand and neutral tokens

| Token | Hex | Use |
| --- | --- | --- |
| `--bg-app` | #F6F1E9 | Page background (brand cream) |
| `--bg-surface` | #FFFDF9 | Cards, tables, drawers |
| `--bg-sunken` | #EFE8DC | Table header, input fill, hover rows |
| `--bg-nav` | #2B2A28 | Left rail (brand charcoal) |
| `--border` | #E6DED1 | 1 px card and table borders |
| `--text-primary` | #2B2A28 | Body text, numbers |
| `--text-secondary` | #6B655C | Labels, metadata |
| `--text-on-nav` | #F6F1E9 | Text and icons on the charcoal rail |
| `--brand` | #C1502E | Primary buttons, active nav item, selected tab, focus ring |
| `--brand-hover` | #A8431F | Button hover; links and any terracotta text on cream |
| `--brand-tint` | #F3E1D9 | Selected table row, active filter chip |
| `--highlight` | #D9A441 | Selected animal ring on the map, one KPI underline. Never text, never status |

### Status tokens (semantic, never brand)

| Status | Solid | Tint | Icon | Meaning |
| --- | --- | --- | --- | --- |
| Inside boundary | #3E7C59 | #E3EFE7 | check-circle | Last fix inside its geofence |
| Near boundary | #B7791F | #FBF0DC | alert-triangle | Inside, but within the warning buffer |
| Breach | #B0172E | #FBE5E8 | shield-alert | Confirmed outside its geofence |
| Fast movement | #6D3FA8 | #EEE6F7 | truck | Speed suggests transport by vehicle |
| Stale or offline | #7A7F87 | #ECEDEF | wifi-off | No fix within the threshold |
| Info | #2F6690 | #E2ECF4 | info | System messages |

### Contrast rules (checked)

- &#91;Certain\] Charcoal on cream is about 12.7:1. Use it for all body text.
- &#91;Certain\] White on terracotta is about 4.7:1, so terracotta buttons with white labels pass WCAG AA.
- &#91;Certain\] Terracotta text on cream is about 4.2:1, which fails AA for small text. Use `--brand-hover` (#A8431F, about 5.4:1) for links.
- &#91;Certain\] Gold on cream is about 2:1. Gold is never used for text.

### Map palette

Land #F3EDE3, water #CFDCE0, major roads #FFFFFF with #E3D9CA casing, minor roads #EDE5D8, district boundaries #B9AE9C dashed, place labels #6B655C. A cream basemap makes the status-colored markers the loudest thing on screen.

### Dark theme (P2)

Background #1E1D1B, surface #2B2A28, border #3A3835, text #F6F1E9, brand #D4673F (lifted for contrast). Skip it for the demo.

## 4. Typography and foundations

Use Inter for the product UI and keep Helvetica World for marketing, because \[Likely\] Helvetica World is a paid Monotype face that needs a separate web licence, and Inter gives you tabular numbers for free. Sifonn appears only inside the logo files, never as live text.

**Font stack.** `"Inter", "Helvetica World", "Helvetica Neue", Arial, sans-serif` for UI. `"IBM Plex Mono", ui-monospace, monospace` for tag IDs, coordinates and loan numbers. Turn on `font-variant-numeric: tabular-nums` everywhere numbers sit in columns.

| Role | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Page title | 24 / 32 | 600 | One per screen |
| Section title | 18 / 26 | 600 | Card and panel headings |
| KPI value | 32 / 36 | 600 | KPI cards, tabular numbers |
| Body | 14 / 20 | 400 | Tables, drawer content |
| Small | 13 / 18 | 400 | Metadata, timestamps |
| Label | 12 / 16 | 500, uppercase, +0.04em | Column headers, field labels |
| Mono | 13 / 18 | 400 | Tag IDs, lat/long, loan IDs |

**Spacing.** 4 px base; use only 4, 8, 12, 16, 24, 32, 48.

**Grid.** Design at 1440 × 900. Left rail 240 px (72 px collapsed), top bar 64 px, content padding 24 px, 12-column grid with 24 px gutters. The Overview breaks the grid on purpose: the map fills all space between the KPI strip and the alert panel.

**Radius.** 6 px for inputs, badges and chips; 10 px for cards; 14 px for drawers and modals; fully round for status pills and map markers.

**Elevation.** Cards stay flat with a 1 px `--border`. Only things that float over the map get a shadow: `0 4px 16px rgba(43, 42, 40, 0.12)`.

**Icons.** Lucide, outline, 1.5 px stroke, 20 px in UI and 16 px in tables. One custom glyph: a simple cattle head for map markers.

**Motion.** 150 to 200 ms ease-out for drawers and hovers. Exactly one looping animation in the product: a slow pulse ring on unacknowledged breach markers. Honour `prefers-reduced-motion`.

**Formats.** Dates as "08 Oct 2026, 14:32 PKT"; relative time in tables ("23 min ago") with the exact time on hover; distances in km to one decimal; coordinates to five decimals (about 1 m). English first; an Urdu toggle is P2.

## 5. Overview screen layout

The map takes everything left over; the alert feed is fixed on the right, because the officer's job is the list and the map is where they check it.

&#91;embedded content: Overview screen · rail, top bar, KPI strip, map, alert feed\]

At 1440 × 900: left rail 240 px, top bar 64 px, KPI strip 96 px tall with four equal cards, alert panel 360 px wide, map fills the remaining area (about 790 × 690 px). Clicking a marker, an alert or a table row slides the 420 px animal drawer over the alert panel; closing it brings the feed back. Above the fold, the only strong colors are the terracotta active nav item and the status colors, so a breach is the first thing the eye finds.

## 6. Map design

Use MapLibre GL JS with a custom cream vector style, because \[Likely\] a branded basemap is the single biggest thing that makes this look like a product rather than a Google Maps embed. Tiles from MapTiler or Stadia (free tiers cover a demo); add a satellite toggle so officers can check a farm on the ground.

**Default view.** Fit to Punjab at load. Buttons: "Punjab", "Pakistan", "Fit to all animals". No world view in the UI.

**Boundaries layer.** District and tehsil polygons for Pakistan from the OCHA HDX administrative boundaries dataset \[Likely\], stored in PostGIS and served as GeoJSON or vector tiles. Shown faintly (#B9AE9C, dashed, 1 px) at all zooms, labelled at zoom 8 and above.

**Markers.**

- 28 px circle, white 2 px outline, filled with the status solid color, cattle glyph inside.
- Selected: gold 3 px outer ring and 1.15× scale; the drawer opens.
- Breach, unacknowledged: crimson marker plus a slow pulse ring.
- Stale: grey fill at 60% opacity with a small clock badge, so old positions never look current.

**Clustering.** Cluster below zoom 10 with supercluster. A cluster bubble shows its count; if it contains any breach, it gets a crimson outer ring and a small red badge with the breach count. Breaches must never hide inside a cluster.

**Geofences.** District fences: dashed charcoal outline, no fill. Custom fences: 1.5 px terracotta outline, terracotta fill at 6%. A fence with a breach turns its outline crimson. The warning buffer draws as a thin inner dashed line.

**Trail and playback.** In the animal drawer, "Show trail" draws the last 24 h (switchable to 7 days) as a 2 px charcoal line with a dot per fix; hover shows time and speed. A playback slider under the map scrubs through fixes. Dots, not a smooth curve: the gaps between fixes are real.

**Executive layer (P1).** A district choropleth of financed animals per district, cream to terracotta, for the "bank-wide picture" moment in the demo.

**Floating controls.** Top right: layer switcher, zoom, fit, fullscreen. Bottom left: collapsible legend listing every status color with its icon and label.

## 7. Geofencing and alerts

A breach should fire on two consecutive fixes outside the fence, or one fix more than a buffer outside it, because \[Likely\] cheap GPS modules drift tens of metres and a single noisy fix near a district line will otherwise spam the bank with false alarms. False alarms in week one will kill trust faster than a missed alert.

### Three fence types

1. **Administrative (default).** The borrower's registered district or tehsil, assigned automatically on enrolment. One click, no drawing.
2. **Custom polygon.** Drawn on the map (terra-draw or MapLibre Draw), for farms that straddle boundaries or for tighter zones.
3. **Radius.** A circle around the farm or home point, for example 2 km. Quick to set from the animal drawer.

Each fence has a name, a type, a warning buffer (default 500 m inward), and the animals or borrowers assigned to it. One animal has exactly one active fence.

### Alert types

| Alert | Fires when | Severity |
| --- | --- | --- |
| Breach | Confirmed outside its fence (rule above) | Critical |
| Near boundary | Inside the warning buffer | Warning |
| Fast movement | Speed between two fixes above about 15 km/h, i.e. likely on a vehicle | Critical |
| Tag offline | No fix within the threshold (default 6 h, configurable) | Warning |
| Low battery | Battery below 20% | Info |
| Returned | A breached animal is back inside its fence | Info |

&#91;Likely\] "Fast movement" is the alert the bank will value most: an animal on a truck is the early signal of an unauthorised sale, often before it leaves the district.

### Alert lifecycle

1. **New**: appears in the feed, bell count and a toast; marker pulses.
2. **Acknowledged**: someone has seen it; pulse stops.
3. **Assigned**: routed to the responsible branch officer, who gets an SMS.
4. **Resolved**: closed with a required reason (returned home, false alarm, moved with bank consent, escalated to recovery) and an optional note.

Never auto-close a breach when the animal returns; raise a "Returned" event and leave the breach for a human to resolve. Banks need the audit trail.

### Alert card anatomy

Severity icon and color bar on the left. Title in plain words ("Left Lahore district"). Second line: tag ID in mono, borrower name, loan ID. Third line: branch, time, and the fact that matters ("14.2 km outside boundary" or "38 km/h"). Actions: View on map, Acknowledge, Assign.

## 8. Component library

Build these twelve components once with shadcn/ui and Tailwind tokens from section 3, and every screen is assembled from them; resist one-off styling.

| Component | Spec |
| --- | --- |
| KPI card | Surface, 1 px border, 10 px radius, 20 px padding. Label (12 uppercase), value (32 tabular), delta vs yesterday (13, green or crimson with arrow). The breach card gets a 3 px crimson top bar when its value is above zero |
| Status pill | Fully round, tint background, solid-color text and 14 px icon, 12/500. Icon plus word, never color alone |
| Data table | 48 px rows, sticky header on `--bg-sunken`, no zebra, hover row `--bg-sunken`, selected row `--brand-tint`. Status column first, "Last fix" relative, a locate-on-map icon button at row end |
| Animal drawer | Right side, 420 px, 14 px radius on the left edge. Header: tag ID (mono), status pill, close. Mini map. Tabs: Location, Borrower and loan, Tag health, Events |
| Alert feed item | Card from section 7, 12 px padding, 4 px severity bar on the left, unread dot |
| Filter bar | Chips for Region, Branch, District, Status, Last fix; active chip in `--brand-tint` with terracotta text; "Clear all" ghost button |
| Buttons | Primary: terracotta, white label. Secondary: 1 px charcoal outline. Ghost: text only. Destructive: crimson. 36 px tall, 6 px radius |
| Toast | Top right, 360 px, 8 s, left color bar by severity, one action ("View") |
| Battery and signal | 4-bar mini glyphs, grey to amber to red by level, exact value on hover |
| Timestamp | Relative text with absolute PKT time in a tooltip; turns grey with a clock icon once stale |
| Map popup | 280 px card on marker click: tag ID, borrower, last fix, status, "Open details" |
| Empty, loading, error | Cream skeleton shimmer for loading; one sentence plus one action for empty; error states say what failed and offer a retry |

**Demo-mode banner.** A thin gold-bordered strip under the top bar: "Demo environment: 1 live tag, 240 simulated animals." Keep it visible; it protects your credibility when the bank asks how many tags are real.

## 9. System architecture and tech stack

Feed the simulated fleet through the same ingestion endpoint as the real tag, so the demo exercises the real pipeline and switching to real tags later changes nothing in the dashboard.

&#91;embedded content: System architecture · tag to dashboard, with demo simulator\]

Every fix lands in PostGIS; the alert engine checks it against the animal's fence and speed rules; the backend pushes changes to the dashboard over WebSocket and alerts out by SMS and email.

| Layer | Recommended | Why |
| --- | --- | --- |
| Frontend | Next.js + TypeScript, Tailwind, shadcn/ui, TanStack Table | Same Next.js + Postgres stack as your QR-tag app, so code and habits carry over |
| Map | MapLibre GL JS, supercluster, terra-draw, Turf.js | Open source, fully styleable, no per-load fees |
| Realtime | WebSocket fed by Postgres LISTEN/NOTIFY or Redis pub/sub | New fixes and alerts appear without refresh |
| Backend | Node (Fastify or NestJS) or FastAPI | Pick whichever Sultan's team already writes fastest |
| Database | PostgreSQL + PostGIS | `ST_Contains` for fences, `ST_Distance` for "km outside", district polygons stored natively |
| Ingestion | MQTT broker (EMQX or Mosquitto) or an HTTPS endpoint | Depends on what the tag firmware sends; confirm with hardware |
| Notifications | A local SMS gateway plus email | \[Guessing\] which SMS provider; Jazz is a natural fit given the existing relationship |
| Simulator | A script walking 200 to 300 animals along real roads in a few districts | Fills the map credibly; scripted breaches and a fast-movement event for the demo |

&#91;Guessing\] Bank IT will ask where the data is hosted. Prepare a one-line answer before the meeting, even if it is "pilot on cloud, production wherever the bank requires".

## 10. Demo script and questions for the bank

The demo's climax is a live breach: someone carries the real tag across a fence you drew minutes earlier, and the alert lands on screen in front of the bank. Design the whole 10 minutes around that moment.

### Demo flow (about 10 minutes)

1. **Bank-wide picture (1 min).** Overview opens on Punjab with the simulated fleet; read the four KPIs aloud.
2. **Find a loan (1 min).** Search a loan ID; the map flies to the borrower's animals; open the drawer.
3. **History (1 min).** Show the 24 h trail and scrub the playback slider.
4. **Draw a fence (2 min).** Draw a small custom polygon around the room or building where the live tag is.
5. **Live breach (2 min).** A teammate walks the real tag outside the fence; the toast, pulse and feed item appear. Acknowledge and assign it to a branch officer.
6. **Fast movement (1 min).** Trigger a simulated animal moving at highway speed; explain why it signals an unauthorised sale.
7. **Close the loop (2 min).** Resolve the breach with a reason, then open the daily breach report as a PDF.

Risk to plan for: \[Likely\] indoor GPS fixes are slow or fail. Test the live-breach step at the venue, keep the tag near a window, and have a pre-recorded simulated breach ready as backup.

### Questions to ask Bank of Punjab

- [ ] Which boundary counts as the limit: district, tehsil, or a radius around the borrower's home?
- [ ] Who must receive a breach alert: branch officer, regional manager, recovery team? By SMS, email, or dashboard only?
- [ ] How fast must they know: within minutes, or is a few hours acceptable? This sets the tag's reporting interval and battery life.
- [ ] Will the bank share loan and borrower data with us, and in what form (CSV, core-banking API)? Any data residency rules?
- [ ] Does the bank want its own logo and colors on the dashboard (white label) or a co-branded "Powered by Bovine" product?
- [ ] Roughly how many animals in the first rollout, and in which districts?
