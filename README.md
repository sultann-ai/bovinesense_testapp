# BovineSense

Livestock-collateral monitoring for lenders. BovineSense answers one question every day: **which financed animals are outside their permitted area, and whose loan is it?**

A GPS tag on each animal reports its position. The platform checks every position against the animal's geofence, raises alerts (breach, near boundary, fast movement, low battery, offline), and lets branch staff acknowledge, assign and resolve them with a full audit trail.

It is **multi-tenant**: any bank or lender is an *organization* with its own regions, branches, borrowers, loans, animals and users, isolated from every other organization by database Row Level Security. Nothing in the code names a lender.

## Features

- **Overview:** live map of every animal with clustering, KPI cards (animals monitored, inside boundary, active breaches, offline tags) that filter the map and the alert feed, status and last-fix filters, and a live alert panel.
- **Alert lifecycle:** new → acknowledged → assigned → resolved. Resolving needs a reason; every step is audited; a breach is never closed automatically. Alerts can be exported to CSV.
- **Animal drawer:** last fix, 24 h / 7 day trail with playback, borrower and loan, tag health, event history.
- **Geofences:** district, polygon and radius fences drawn on the map; assign animals; edit the warning buffer.
- **Devices:** tag inventory (battery, signal, last contact, unassigned flag) and per-organization device API keys.
- **Roles:** `org_admin`, `regional_manager`, `branch_officer`, `auditor` (read-only), plus `platform_admin` for BovineSense staff. Access is enforced in Postgres, not only in the UI.
- **Realtime:** Supabase Realtime pushes new fixes and alerts to open dashboards within seconds.
- **Simulator:** 240 simulated animals use the same ingestion endpoint as a real tag.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| UI | Radix UI primitives, Lucide icons, class-variance-authority |
| Backend | **Supabase only:** Postgres + PostGIS, Auth, Realtime, `pg_cron` |
| Maps | Google Maps JavaScript API (`@vis.gl/react-google-maps`), marker clusterer, Terra Draw, Turf.js |
| Validation / tests | Zod, Vitest (PGlite for the database tests) |

There is no Docker, no local Postgres and no second backend service.

## How it fits together

```
 GPS tag / simulator ──POST /api/ingest/fix (device key)──▶ ingest_fix()  ── one transaction in Postgres:
                                                            store fix, run alert rules, write alerts
                                                                   │
                                  Supabase Realtime (filtered by Row Level Security)
                                                                   ▼
 Browser (Next.js) ◀── pages and API routes read as the signed-in user (anon key + session)
```

- **Postgres is the rules engine.** Alert evaluation, state changes and offline detection live in SQL functions, so a real tag and the simulator behave identically.
- **Tenant isolation is Row Level Security.** Every business table has `organization_id` and policies; app-side filters are only for convenience.
- **The service-role key never reaches the browser.** It is used only by the ingestion route, the access check on the server, and local scripts. `npm run check:bundle` verifies that after a build.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Prerequisites

- **Node.js 20.9 or newer** (developed on Node 24) and npm
- A **Supabase** project (the free plan is enough)
- A **Google Maps** API key and Map ID (optional to start: without them the app runs and shows a map-setup message instead of the map)

The Supabase CLI is installed with the project (`npx supabase ...`).

## Getting started

### 1. Install

```bash
git clone <repository-url>
cd <repository-folder>
npm install
```

### 2. Create a Supabase project

In the [Supabase dashboard](https://supabase.com/dashboard) create a project and note its **database password**. Then:

1. **Database → Extensions:** enable `postgis` and `pg_cron`.
2. **Project Settings → API (or API Keys):** copy the Project URL, the publishable (anon) key and a secret (service-role) key.

### 3. Configure the environment

Copy `.env.example` to `.env.local` and fill it in. Never commit `.env.local`.

| Variable | Public | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Publishable key; safe in the browser, limited by Row Level Security |
| `SUPABASE_SERVICE_ROLE_KEY` | **no (secret)** | Server and scripts only; bypasses Row Level Security |
| `NEXT_PUBLIC_SITE_URL` | yes | App address, e.g. `http://localhost:3000` (used in invitation and reset links) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | yes | Maps JavaScript API key (restrict it by HTTP referrer) |
| `NEXT_PUBLIC_GOOGLE_MAP_ID` | yes | Cloud-styled Map ID, see [docs/MAP_STYLE.md](docs/MAP_STYLE.md) |
| `REAL_TAG_SERIAL` | no | Optional: serial of one real tag to reserve for demos |
| `INGEST_RATE_LIMIT_PER_MIN` | no | Optional: fixes per device key per minute (default 3000) |

### 4. Create the database

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # asks for the database password
npx supabase db push                                  # applies every file in supabase/migrations
npm run types:gen                                     # optional: refresh src/types/database.ts
```

If `pg_cron` was enabled after the push, run `select public.schedule_background_jobs();` once in the SQL Editor.

### 5. Load the demo data

```bash
npm run import:boundaries      # district polygons (from data/pak_adm2.geojson)
npx supabase db query --linked -f supabase/seed.sql              # two organizations, 254 simulated animals
npx supabase db query --linked -f supabase/seed_demo_state.sql   # 4 breaches, 10 near boundary, 2 fast, 5 offline
npm run seed:accounts          # one development login per role (see docs/TEST_ACCOUNTS.md)
```

The two SQL files can equally be pasted into the Supabase **SQL Editor**. Both are safe to run twice.

### 6. Configure sign-in

In the Supabase dashboard, **Authentication**:

- **URL Configuration:** Site URL `http://localhost:3000`; add `http://localhost:3000/**` to Redirect URLs.
- **Sign In / Providers:** turn **off** "Allow new users to sign up" (accounts are invite-only).

### 7. Run

```bash
npm run dev
```

Open <http://localhost:3000> and sign in with `org-admin.bop@bovinesense.test` (password in [docs/TEST_ACCOUNTS.md](docs/TEST_ACCOUNTS.md)). You should land on Bank of Punjab with 240 animals.

### 8. Make the map move (optional)

```bash
npm run device-key -- create --org bank-of-punjab --label Demo   # prints a key once
$env:DEVICE_API_KEY = "<key>"                                    # PowerShell; use export on macOS/Linux
npm run simulate -- --org bank-of-punjab                         # animals drift
npm run simulate -- --scenario=breach --org bank-of-punjab       # one animal walks out of its district
npm run simulate -- --scenario=fast-movement --org bank-of-punjab
```

Run one simulator at a time, or pass the same `--key` to each.

## Test accounts

`npm run seed:accounts` creates one account per role in each demo organization (Bank of Punjab and Demo Bank), a platform admin and a user in both organizations. They share one published development password, so **never create them in a project that holds real data**. Remove them with `npm run seed:accounts:remove`. Full list: [docs/TEST_ACCOUNTS.md](docs/TEST_ACCOUNTS.md).

Real users are invited, never given a shared password:

```bash
npm run invite -- person@example.com --org <organization-slug> --role org_admin
```

To add a new lender, run [supabase/scripts/onboard_org.sql](supabase/scripts/onboard_org.sql) in the SQL Editor (commented, one transaction).

## Roles

| Role | Scope | Can do |
|---|---|---|
| `platform_admin` | all organizations, read-only | support access; every cross-tenant open is audit-logged |
| `org_admin` | one organization | everything inside it: users, geofences, devices, alerts |
| `regional_manager` | one region | read and act on that region's alerts and animals |
| `branch_officer` | one branch | read the branch; acknowledge, assign, resolve its alerts |
| `auditor` | one organization | read-only |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development server, production build, production server |
| `npm run lint` | ESLint |
| `npm test` | All tests (unit, route and database tests on PGlite) |
| `npm run check:bundle` | After a build: fails if the service-role key could reach a client file |
| `npm run db:push` | Apply migrations to the linked Supabase project |
| `npm run types:gen` | Regenerate `src/types/database.ts` from the database |
| `npm run import:boundaries` | Import district boundaries into PostGIS |
| `npm run seed:accounts[:remove]` | Create or remove the development test accounts |
| `npm run seed:real-tag` | Reserve the real demo tag (`REAL_TAG_SERIAL`) |
| `npm run simulate` | Simulator (`--org`, `--scenario=breach\|fast-movement\|offline`, `--key`, `--url`) |
| `npm run device-key` | Create, list or revoke an organization's device keys |
| `npm run invite` | Invite a user into an organization |

## Testing

```bash
npx tsc --noEmit    # type check
npm run lint
npm test            # ~740 tests; no network or Docker needed
npm run build && npm run check:bundle
```

The database tests (`tests/db`) run the real migrations on PGlite and prove tenant isolation, role permissions, the alert rules and the ingestion function. A manual click-through for the whole product is in [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md).

## Project structure

```
src/
  app/            App Router: (app) signed-in screens, (auth) sign-in, api/ thin route handlers
  components/     ui/ shared components, shell/ rail + top bar, map/, overview/, alerts/, geofences/ ...
  lib/            auth, permissions, maps helpers, alert rules, formatting, supabase clients
  types/          database types generated from Supabase
supabase/
  migrations/     schema, RLS policies, SQL functions, pg_cron jobs (applied in order)
  scripts/        onboard_org.sql (create an organization)
  seed.sql, seed_demo_state.sql
scripts/          simulator, device keys, invitations, boundary import, bundle check
tests/            Vitest suites (tests/db for the database)
docs/             architecture, operations, deployment, design, demo and test guides
data/             Pakistan district boundaries (GeoJSON)
```

## Deployment

Deploy to Vercel with the same environment variables; step-by-step instructions, including restricting the Google Maps key to the deployed domain, are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Security notes

- The service-role key is server-only. Never prefix it with `NEXT_PUBLIC_`, never import it from client code, and never commit it.
- Row Level Security is enabled on every table; each migration that creates a table enables it in the same file.
- `/api/ingest/fix` authenticates with per-organization device keys (stored only as SHA-256 hashes) and is rate limited per key and per address (in memory, per server instance).
- Security headers are set in `next.config.ts`. A Content-Security-Policy is not set yet (see docs/DEPLOY.md).
- Rotate any key that has been shared in chat or email.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Invalid API key` from a script or the app | A wrong or truncated key in `.env.local`; restart `npm run dev` after editing |
| Redirected back to `/login` | Sign-up is off and the account does not exist: run `npm run seed:accounts` |
| Empty dashboard | The seed was not run, or you are signed in to Demo Bank (14 animals) |
| Map shows a setup message | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / `NEXT_PUBLIC_GOOGLE_MAP_ID` not set |
| `db push` fails on an extension | Enable `postgis` and `pg_cron` under Database → Extensions, then push again |
| Simulator stops with "device key was rejected" | The key was revoked, or a second simulator started without `--key` and revoked it |
| `/api/health` returns 503 | Database unreachable, or a `pg_cron` job is stale |

More: [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Documentation

| File | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data flow, tables, alert rules, ingestion API |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Tenancy, auth, realtime, background jobs, retention, storage, RLS, troubleshooting |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Vercel deployment and environment variables |
| [docs/MAP_STYLE.md](docs/MAP_STYLE.md) | Google Maps setup and key protection |
| [docs/DESIGN.md](docs/DESIGN.md) | Design language and component specs |
| [docs/TEST_ACCOUNTS.md](docs/TEST_ACCOUNTS.md) | Development logins |
| [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) | Demo script and backup plan |
| [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md) | 15-item click-through checklist |
