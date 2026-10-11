# Operations and reference

Reference notes for running and maintaining BovineSense: tenancy, authentication, ingestion, realtime, background jobs, retention, storage, branding, the map, Row Level Security, tests and troubleshooting. For installation start with the [README](../README.md).


## Tech stack

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Radix UI, Lucide
- **Supabase**: Postgres + PostGIS (database), accessed with `@supabase/supabase-js` / `@supabase/ssr`
- Google Maps JavaScript API (`@vis.gl/react-google-maps`), `@googlemaps/markerclusterer` and Terra Draw
- Vitest

No Docker and no local Postgres are used or needed. The database lives in a Supabase project and is changed only through SQL files in `supabase/migrations/`.

## Free-plan limits to know about

- **Pausing:** a free project pauses after about a week without activity. Restore it from the dashboard, or keep it awake (see "Health check, and keeping a free-tier pilot awake").
- **500 MB database:** the simulator writes 240 fixes every 8 seconds, roughly 2.6 million rows a day (about 860 MB). Run it for demos, not continuously, give the demo organization a short retention window, or prune old data in the SQL Editor (see "Storage" for the numbers):
  ```sql
  delete from public.fixes where fixed_at < now() - interval '2 days';
  ```
- **1000 rows per API response** (`max_rows`): maps and lists are capped at 1000 rows. Fleets larger than that need paging or server-side clustering.
- Every fix ingested is one database call (`ingest_fix`); the simulator still limits itself to 8 in flight.
- **Realtime:** the plan limits concurrent connections and messages per second (see **Project Settings → Realtime** and the pricing page for the current numbers). Every open tab is one connection and receives one message per change it is allowed to see; the simulator at 240 animals every 8 seconds is about 30 messages a second to each open admin tab.

## Multi-tenancy

BovineSense is multi-tenant: **Bank of Punjab is one organization, not the product.** Any lender is onboarded by inserting a row into `organizations`.

- Every business table carries `organization_id` (NOT NULL, foreign key, index). `district_boundaries` is shared reference data and has none.
- A row can never reference a row of another organization: every parent exposes `UNIQUE (organization_id, id)` and every child references that pair (an animal's loan, tag, borrower and branch must share its organization). The database rejects violations itself, not only the app.
- Region names, branch codes, loan numbers and CNICs are unique **per organization**. Tag serial numbers stay globally unique because ingestion resolves a tag from its serial alone.
- People: `profiles` (one row per Supabase Auth user, created automatically) and `memberships` (user + organization + role, optionally scoped to a region or branch). Roles: `org_admin`, `regional_manager`, `branch_officer`, `auditor`. An alert can only be assigned to a member of its own organization.
- **Row Level Security policies are not written yet**; see "Authentication" for what enforces isolation in the meantime.

Run [supabase/tests/tenancy_constraints.sql](../supabase/tests/tenancy_constraints.sql) in the SQL Editor after seeding to confirm the database refuses cross-organization data. It leaves nothing behind.

### Add a member

Create the user in **Authentication → Users** first, then in the SQL Editor:

```sql
insert into public.memberships (user_id, organization_id, role)
select u.id, o.id, 'org_admin'
from auth.users u, public.organizations o
where u.email = 'someone@example.com' and o.slug = 'bank-of-punjab';
```

Regional managers need `region_id`, branch officers need `branch_id` (ids from that organization's `regions` / `branches`).

## Authentication

**Flow.** `/login` (email + password) → `/org/continue` → the dashboard. After sign-in the app looks up the user's memberships: one organization goes straight in, several (or a BovineSense platform admin) get the organization picker at `/select-organization`. The chosen organization is kept in an HttpOnly cookie (`bs_active_org`); *Switch organization* in the account menu returns to the picker, and signing out clears it.

**Who may do what** (enforced on the server for every request):

| Role | Sees | Can change |
|---|---|---|
| Organization admin | the whole organization | everything, including geofences |
| Regional manager | their region | acknowledge / assign / resolve alerts in the region |
| Branch officer | their branch | acknowledge / assign / resolve alerts in the branch |
| Auditor | the whole organization | nothing (read-only) |
| Platform admin | any active organization they open (audited in `platform_audit_log`) | nothing: read-only (to act inside an organization they need a membership there) |

**Enforcement, layer by layer.**

1. **The database** (the authority): Row Level Security refuses any row or action the user's role does not allow, whatever code is calling. See "Row Level Security".
2. `src/proxy.ts` (Next 16's renamed middleware) refreshes the session cookies on every request, sends signed-out users to `/login` (pages) or answers 401 (API), and sends users with no organization to `/org/continue`. Public routes: `/login`, `/reset-password`, `/api/ingest/*` (tags authenticate with their API key).
3. `src/lib/auth/access.ts` re-checks the active-organization cookie against the user's memberships on **every** server request. A forged or stale cookie yields 403 on the API and a redirect back to the picker on pages.
4. Every API route starts with `requireApiAccess()` (`src/lib/auth/api.ts`), checks `can()` from `src/lib/permissions.ts` for a clear 403, and scopes its queries to the active organization. Who performed an alert change is taken from the session, never from the request body.
5. The UI hides or disables what the role cannot do (`PermissionsProvider`): acknowledge / resolve buttons, bulk selection, *New geofence*, delete icons, the Settings link and page.

**The app queries as the user.** `ctx.db` is a Supabase client carrying the signed-in user's token, so RLS applies to every normal request. The service-role client is used only where no user exists: tag ingestion (`/api/ingest/fix`) and the command-line scripts.

**Other limits.**

- A tab left open after the user is signed out elsewhere keeps its realtime connection until its access token expires (about an hour) or the page reloads; every data request it makes is refused at once, and `SessionGuard` sends it to `/login`.
- Accounts are managed from the command line (`npm run invite`) until the Settings screen is built.
- `SessionGuard` sends an open tab to `/login` when the API reports the session has ended.

### Invitations and password reset

- **Invite:** `npm run invite -- <email> --org <slug> --role <role>` (add `--region "<name>"` for a regional manager, `--branch <code>` for a branch officer, `--platform` for BovineSense staff). It sends Supabase's invitation email and creates the membership. If the address already has an account, only the membership is added. You can also use **Authentication → Users → Invite user** in the dashboard, then add the membership with the SQL under "Add a member".
- **Forgot password:** *Forgot password?* on the sign-in page sends a reset link. The form always answers "if an account exists…" so it cannot be used to find out which addresses have accounts.
- Both links open `/reset-password`, where the person chooses a password. The one-time token is removed from the address bar immediately.

### Security notes

- Sign-in failures never say whether the email exists. Supabase rate-limits sign-ins and reset emails.
- `?next=` after sign-in accepts only same-site paths (open-redirect safe).
- Sign-out and organization selection are form POSTs to route handlers that also check the request's Origin, on top of SameSite=Lax cookies.
- The test accounts share one published password: development only, never in a project with real data.

## Ingestion and device keys

Tags, gateways and the simulator send fixes to `POST /api/ingest/fix`. There is no shared secret: **every organization has its own device keys**, and a key can only ever write to its own organization's animals.

**Keys.** An organization admin creates them in **Settings → Device keys** (or `npm run device-key -- create --org <slug> --label "Lahore gateway"`). The plain key (`bsk_…`) is shown **once**; only its SHA-256 hash is stored (`device_api_keys.key_hash`), so a database leak does not leak working keys. A key shows its first characters, when it was last used, and can be revoked (permanently) at any time. `npm run device-key -- list --org <slug>` and `-- revoke --org <slug> <id>` do the same from the command line (service-role key, trusted machine).

**Request.**

```http
POST /api/ingest/fix
X-Api-Key: bsk_…
Content-Type: application/json

{ "tag_serial": "SIM-00001", "lat": 31.52, "lon": 74.36, "fixed_at": "2026-10-09T14:32:00Z",
  "speed_kmh": 0.8, "battery_pct": 82, "signal_bars": 4 }
```

| Status | Meaning |
|---|---|
| `201` `{ fix_id, animal_id, alerts_raised }` | Stored. A retransmitted fix (same tag and `fixed_at`) is also `201`, with the same ids and `alerts_raised: 0`. |
| `400` | Invalid JSON or body. `fixed_at` needs a UTC offset and may not be more than 5 minutes in the future (a tag with a wrong clock would otherwise freeze its animal's status). |
| `401` | No key, a malformed, unknown or revoked key, or a suspended organization. |
| `404` | The tag is not in **the key's organization**, or has no animal assigned. Another organization's tag is indistinguishable from an unknown one. |

**What happens inside.** The route checks the key, validates the body with zod, and makes **one** call to the Postgres function `ingest_fix()` with the service role. In a single transaction the function re-validates the key, finds the tag inside the key's organization, locks the animal, inserts the fix (the PostGIS point is generated from lat/lon), and runs every alert rule. Either everything is stored or nothing is. The organization always comes from the key, never from the request body.

**The alert rules live in the database** (`supabase/migrations/20261009000006_ingestion.sql`), so every ingest path behaves identically. They replace the TypeScript engine in `src/lib/alerts/` (kept only for reference, deprecated).

| Rule | Fires when | Default |
|---|---|---|
| Breach (critical) | outside the active fence on N consecutive fixes, **or** at least a distance outside on one fix. Raised once per breach | N = 2, 200 m |
| Near boundary (warning) | inside and nearer to the edge than the fence's warning buffer; or one outside fix below the breach distance | buffer 500 m (per fence) |
| Fast movement (critical) | speed strictly above the threshold (the tag's, or computed from the previous fix). One open alert at a time | 15 km/h |
| Low battery (info) | battery strictly below the threshold. One open alert at a time | 20 % |
| Returned (info) | a breached animal is inside again. The breach stays open for a person to resolve | n/a |

**Per-organization thresholds.** Defaults apply unless the organization's `settings` JSON overrides them:

```sql
update public.organizations
set settings = settings || '{"alert_rules": {"hard_breach_metres": 300, "breach_consecutive_fixes": 3,
                                              "speed_threshold_kmh": 20, "low_battery_pct": 25}}'
where slug = 'demo-bank';
```

An invalid value (a string, a negative number) falls back to the default instead of stopping ingestion. The warning buffer is set per fence (`geofences.warning_buffer_m`). The tag-offline rule is not part of ingestion; it runs on a schedule (see "Background jobs" below).

**Also guaranteed:** a fix older than the animal's newest one is stored as history but cannot change its status or raise alerts; an animal with no fence still updates `last_seen_at` and gets the speed and battery rules.

## Realtime

The dashboard updates by itself, with no polling and no server-side event stream. There is **no event bus and no `/api/events` route**; the database is the source of truth and Supabase Realtime carries its changes to the browser.

**What happens.** `ingest_fix()` (or a person acknowledging an alert) writes rows. Supabase Realtime streams those row changes (`postgres_changes`) to every subscribed browser:

| Table | Change | Updates |
|---|---|---|
| `fixes` | insert | the animal's marker moves (batched, so a busy fleet is one map redraw, not hundreds) |
| `alerts` | insert | the alert feed, the bell and sidebar badge, the KPI strip, and a **toast** for new critical or warning alerts, on whichever screen you are on |
| `alerts` | update | the same, when anyone acknowledges, assigns or resolves |
| `animals` | update | the marker's status colour and the KPI strip |

**One subscription for the whole app.** `RealtimeProvider` (`src/components/realtime/`) is mounted once in `src/app/(app)/layout.tsx`. It opens one channel with three bindings, each filtered by `organization_id=eq.<active organization>`, and shares the state: the KPI numbers, the open-alert count behind the bell and the sidebar badge, the toasts, and a feed of events that screens subscribe to. Moving between screens does not reconnect; switching organization starts a fresh subscription.

**Row Level Security applies to Realtime.** Realtime delivers a change only if the *subscriber's own* role passes the table's SELECT policy, using the user's JWT. So the policies from migration 5 decide who receives what: a Demo Bank user never receives a Bank of Punjab row, a branch officer never receives another branch's, an auditor receives (read-only) their whole organization. The `organization_id` filter is only a courtesy to cut traffic, and the client additionally drops any row that is not the active organization's, so a user who belongs to two organizations never sees one mixed into the other. Nothing sensitive is published: only `fixes`, `alerts` and `animals` (never device keys, memberships, profiles or borrowers), and `tests/db/realtime.test.ts` pins that list.

**Connection state.** The top bar shows a small pill: **Live**, **Connecting…** or **Reconnecting…** (icon plus word, never colour alone). While it is not Live, what is on screen may be out of date, and it says so.

**Reconnect, and nothing missed.** Realtime does not replay changes from while a connection was down. So on the first connect and after **every** reconnect the provider tells each screen to refetch its state (KPIs, alert feed, markers). Reconnection itself is automatic: the client library rejoins when the socket returns, a watchdog rebuilds a channel that stays down (with back-off, capped at 30 s), and returning to a tab that was asleep or coming back online triggers a refresh. There is no polling fallback.

**Verifying realtime isolation against your own project.** The automated tests prove the policies (`tests/db/realtime.test.ts`), the client logic (`tests/realtime*.test.ts`) and, in a browser against a mock server, the whole behaviour. The Realtime *server* itself is Supabase's, so check it once on your project:

1. Sign in as `org-admin.bop@…` in one browser and `org-admin.demo@…` in another (a private window). Both top bars should say **Live**.
2. Run `npm run simulate:fast -- --org demo-bank`.
3. Demo Bank's window shows a toast, a new alert in the feed and a higher bell count within a second or two. **Bank of Punjab's window shows nothing**: no toast, no change in the bell.
4. Stop the simulator, run `npm run simulate:fast -- --org bank-of-punjab`, and confirm the mirror image. Then sign in as `branch-officer.bop@…` in a third window: it only reacts to alerts in its own branch.
5. In the browser's developer tools (Network → WS) you should see a single `realtime` WebSocket per tab, and the join message lists three `postgres_changes` bindings with `organization_id=eq.<your organization>`.
6. Turn the network off for a few seconds (or use the developer tools' offline switch): the pill turns to **Reconnecting…**, and when the network returns it is **Live** again and anything raised meanwhile appears.

If the pill stays on Connecting or Reconnecting, see Troubleshooting.

## Background jobs, retention and storage

Everything here runs **inside Postgres** (pg_cron), so it behaves the same whatever hosts the app and keeps working when no browser is open. It is defined in `supabase/migrations/20261009000008_background_jobs.sql`.

### Background jobs (pg_cron)

| Job (pg_cron name) | Schedule | Runs | What it does |
|---|---|---|---|
| `bovinesense-check-offline-tags` | every 15 minutes | `select public.check_offline_tags()` | For **each active organization**, using **its own threshold**, marks animals whose tag has not reported as offline (`status = 'stale'`) and raises one "Tag offline" warning alert per animal |
| `bovinesense-fix-retention` | nightly, 22:00 UTC (03:00 in Pakistan) | `select public.rollup_and_prune_fixes()` | Rolls raw fixes older than the retention window into daily summaries and removes them (next section) |

pg_cron works in UTC. The migration tries to enable the extension and schedule both jobs. If it printed a notice that pg_cron is unavailable, enable it under **Database → Extensions → pg_cron** and run `select public.schedule_background_jobs();` once; running it again is harmless (jobs are replaced by name, never duplicated).

**Offline rule.** A tag is offline when it has not reported for the organization's threshold (default **6 h**). A tag that has never reported counts from when the animal was enrolled, so a new enrolment is not flagged at once. A tag that reports again is brought back by the next fix. Only one open "Tag offline" alert exists per animal at a time. One organization failing is logged as a warning and never stops the others.

**Per-organization settings** (all optional; an invalid value falls back to the default instead of breaking the job):

```sql
update public.organizations
set settings = settings
  || '{"alert_rules":    {"offline_threshold_hours": 3},
       "data_retention": {"fix_days": 14},
       "timezone":       "Asia/Karachi"}'
where slug = 'demo-bank';
```

| Setting | Default | Limits |
|---|---|---|
| `alert_rules.offline_threshold_hours` | 6 | at least 1 |
| `data_retention.fix_days` | 30 | at least 7, so a typo cannot wipe history |
| `timezone` | `Asia/Karachi` | any IANA name; daily summaries are per local day |

**Operating them.**

```sql
select jobname, schedule, active from cron.job where jobname like 'bovinesense-%';
select jobid, status, start_time, return_message
from cron.job_run_details order by start_time desc limit 20;      -- what ran, and whether it worked
select public.check_offline_tags();                               -- run now; returns how many went offline
select public.rollup_and_prune_fixes();                           -- run now; returns how many fixes were removed
select cron.unschedule('bovinesense-fix-retention');              -- stop a job
```

These functions are for the service role and pg_cron only: signed-in users cannot call them.

### Data retention and daily summaries

Raw fixes are kept for **30 days** (setting `data_retention.fix_days`, per organization). Older ones are rolled into `fix_daily_summary`, **one row per animal per local day**:

| Column | Meaning |
|---|---|
| `organization_id`, `animal_id`, `summary_date` | the key (the day is in the organization's timezone) |
| `fix_count` | how many fixes that day |
| `first_fix_at`, `first_lat`, `first_lon` | the day's first position |
| `last_fix_at`, `last_lat`, `last_lon` | the day's last position |
| `max_speed_kmh` | the highest speed reported that day (null if the tag sent none) |

How it behaves:

- **Whole days only.** A day is touched only when it is entirely older than the window, so a summary row is complete. A fix is therefore kept for 30 to 31 days, never less.
- **All or nothing per day.** One statement deletes the day's fixes and writes the summary, so a day is either fully summarised and removed or left exactly as it was. A late fix for a day that was already summarised is merged into that day's row.
- **Catches up.** One run handles at most 60 days (oldest first), so a large backlog is cleared over a few nights without a long lock.
- **Per organization.** Each organization's retention and timezone apply only to its own data; a failure in one is logged and the rest continue.
- **Same visibility as the raw fixes:** whoever can see an animal can read its summaries; nobody can write them through the API. The API does not serve them yet; they are for reports.
- **What is gone is gone.** Raw positions older than the window cannot be restored; only the summary remains (first/last position, count, max speed). The animal trail in the UI shows at most 7 days, so it is unaffected. Export first if you need raw history for longer.

### Index review

Every app query and `ingest_fix()` is scoped to one organization, so two organization-leading composites were added (the migration also org-qualifies the `animal_overview` view and `ingest_fix` so they use them):

| Index | Serves | Replaced (dropped) |
|---|---|---|
| `fixes (organization_id, animal_id, fixed_at desc)` | latest fix, the trail, the previous fix per animal; also the exact column order of the composite foreign key | `fixes_organization_id_idx`, `fixes_animal_time_idx` |
| `alerts (organization_id, status, created_at desc)` | the alert feed and open-alert counts | `alerts_organization_id_idx`, `alerts_status_created_idx` |
| `fixes using brin (fixed_at)` (new) | the nightly retention job: find and delete the old days without reading the whole table | none |

Kept: `fixes_pkey`; `fixes_tag_time_key` (makes a retransmitted fix idempotent); `alerts_animal_idx`.

**Measured, not assumed** (200,000 fixes, inserted in time order, on a real Postgres engine): the BRIN index costs under 1 byte per fix, and at that size the planner uses it for both retention queries. The two fixes indexes that were dropped cost **48 B per fix** (41.5 for `(animal_id, fixed_at)` plus only 6.6 for the organization-only one, which b-tree deduplication makes tiny); the new composite costs **72 B per fix**. So the composite is about **23 B per fix larger** (roughly +7% of a fix's footprint) than what it replaces, and because animal ids are globally unique its organization prefix does not make any query more selective. It was added as requested and because it matches the foreign key. **If storage is your binding constraint**, the cheaper choice is `(animal_id, fixed_at)` alone:

```sql
create index fixes_animal_time_idx on public.fixes (animal_id, fixed_at);
drop index public.fixes_org_animal_time_idx;
```

(The queries would still use it; `ingest_fix` and the view already filter by animal.)

**A candidate to drop, your call:** `fixes_geom_idx` (a GiST index on each fix's point) is not used by any query today: the app finds an animal's position from its latest fix and tests it against the fence point by point. Keeping it costs an estimated 40 to 60 B per fix (about 15% of a fix's footprint) on every insert. Drop it with `drop index public.fixes_geom_idx;` unless you plan "which fixes fell inside this polygon" queries over raw history.

### Storage: what to expect per 1,000 animals

**Per fix on disk, about 330 B** (heap and all indexes). Measured on a real Postgres engine with 200,000 fixes, adjusted for a real PostGIS point (the test engine has no PostGIS):

| Part | Bytes per fix | Basis |
|---|---|---|
| Table row (13 columns, including the generated point) | ~145 | measured 149, with the stand-in geometry replaced by a 32 B PostGIS point |
| `fixes_pkey` | 23 | measured |
| `fixes_tag_time_key` (tag, time) | 42 | measured |
| `fixes_org_animal_time_idx` | 72 | measured |
| `fixes_fixed_at_brin` | ~0 | measured |
| `fixes_geom_idx` (GiST) | ~50 | **estimate**, not measurable without PostGIS |
| **Total** | **~330** (about 280 without the GiST index) | |

**The formula:** `fixes (MB) = animals × (1440 / minutes between fixes) × retention_days × 330 B`, in the steady state, because rows older than the retention window are removed every night.

**Per 1,000 animals, 30 days retained** (the table is flat after the first month; the first month builds it up):

| Tag reports every | Fixes per day | Raw fixes kept | Size | Animals that fit in ~450 MB |
|---|---|---|---|---|
| 5 minutes | 288,000 | 8.64 M | **~2.85 GB** | ~160 |
| 15 minutes | 96,000 | 2.88 M | **~950 MB** | ~470 |
| 30 minutes | 48,000 | 1.44 M | **~475 MB** | ~950 |
| 1 hour | 24,000 | 0.72 M | **~240 MB** | ~1,900 |

**What keeps growing, per 1,000 animals per month** (independent of the reporting interval):

| Data | Rows per month | Bytes per row | Per month |
|---|---|---|---|
| `fix_daily_summary` (1 per animal per day) | 30,000 | ~162 (measured: 117 table + 44 key) | **~4.9 MB** |
| Alerts and their audit events (**assumes 3 alerts per animal per month**, 3 events each) | 3,000 | ~765 (estimate) | **~2.3 MB** |
| **Long-term growth** | | | **~7 MB per month, about 85 MB per year** |

**Assumptions to check against your hardware.** (1) The reporting interval is the biggest lever and is not known yet: DESIGN.md says "every few minutes to hours"; ask the hardware team. (2) Every animal reports every interval, all day. (3) 30 days of retention; the formula scales linearly, so 14 days is 47% of the figures above. (4) The alert rate is a guess. (5) Add **10 to 20%** for table and index bloat between vacuums, and remember a fresh Supabase project already uses a few tens of MB before any of your data (see **Reports → Database**). (6) The GiST figure and the alert-row sizes are estimates; everything else was measured. (7) The database size Supabase counts is the data files; the write-ahead log is not part of it.

**Two warnings from the numbers.** The **free plan's 500 MB** fits about 470 animals at a 15-minute interval with 30-day retention, or about 160 at 5 minutes; lower `data_retention.fix_days` (minimum 7) if you need more headroom. And the **simulator** (240 animals every 8 seconds) writes about 2.6 million fixes a day, roughly 860 MB a day at 330 B each, far faster than the 30-day window can prune: run it for minutes, not hours, and give the demo organization a short window (`"fix_days": 7`), or delete its fixes by hand as shown under "Free-plan limits".

### Health check, and keeping a free-tier pilot awake

`GET /api/health` is a public, lightweight liveness check. It makes a real round trip to the database (a tiny function call plus the last pg_cron run of each job) and reveals no names, counts or error text:

| Response | Meaning |
|---|---|
| `200 {"status":"ok","database":"ok","background_jobs":"ok"}` | all good |
| `200 …"background_jobs":"unknown"` | the database answers, but there is nothing to judge yet: pg_cron is not enabled, or no job has run yet |
| `503 {"status":"degraded","background_jobs":"stale"}` | the database answers but a job has not run for much longer than its schedule (45 minutes for the offline check, 26 hours for retention) |
| `503 {"status":"degraded","background_jobs":"failing"}` | a job's last run failed: see `cron.job_run_details` |
| `503 {"status":"down","database":"down"}` | the database cannot be reached (or the server is misconfigured) |

`HEAD /api/health` returns the same status with no body. Answers are memoised for 5 seconds, so a flood of requests cannot become a flood of database calls.

**Keeping a free project from pausing.** A free Supabase project pauses after about a week without activity, and a paused project stops ingesting fixes and raising alerts. Supabase does not document exactly what counts as activity, so do not rely on pg_cron's own internal jobs; use an **external request that goes through the API**, which `/api/health` does. Any one of these, pointed at your *deployed* app (a localhost-only pilot cannot be reached from outside):

- A free uptime monitor (UptimeRobot, Better Stack, cron-job.org) requesting `https://<your-app>/api/health` every 5 to 15 minutes. It doubles as an alarm: it turns red on a 503, including a stalled background job.
- A scheduled GitHub Action, a few lines of YAML (a daily run is enough to avoid pausing; shorter if you also want the alarm):

  ```yaml
  on:
    schedule: [{ cron: "0 */6 * * *" }]
  jobs:
    ping:
      runs-on: ubuntu-latest
      steps:
        - run: curl --fail --silent --show-error https://<your-app>/api/health
  ```

- No deployed app yet: while demoing locally, open the dashboard (or run the simulator briefly) at least every few days, and check the project is awake before a client meeting. If it did pause, **Restore project** in the dashboard brings it back with its data.

**The database size to watch.** The free plan allows **500 MB** of database. Check **Reports → Database** in the dashboard, or:

```sql
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select relname, pg_size_pretty(pg_total_relation_size(oid)) as total
from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace
order by pg_total_relation_size(oid) desc limit 8;       -- fixes should be the largest by far
```

Act at about **70% (350 MB)**: shorten `data_retention.fix_days`, lengthen the tag reporting interval, or move to a paid plan. Over the limit, Supabase restricts the project (check its current behaviour in the pricing and limits documentation), and ingestion would stop working.

## App shell, tenant branding and settings

The shell (left rail, top bar, banner) is the same for every lender; everything that identifies a tenant comes from its `organizations` row. Nothing in the code names a lender, a region or a branch.

| Where | What it does |
|---|---|
| `organizations.name` | Shown in the top bar with "Powered by BovineSense" |
| `organizations.logo_url` | The logo beside the name (https, http or a site path; anything else is ignored). Without one, or if it fails to load, the tenant's initials are shown |
| `organizations.brand_settings.accent` | Optional accent, `#RRGGBB`. Overrides **only** the brand tokens (`--brand`, `--brand-hover`, `--brand-tint`), never a status colour. An accent white button labels could not be read on (contrast under 4.5:1) is ignored |
| `organizations.settings.timezone` | IANA name for every clock time ("08 Oct 2026, 14:32 PKT"); default `Asia/Karachi` |
| `organizations.settings.demo_mode` | `true` shows the gold demo banner under the top bar |
| `organizations.settings.demo_banner` | Optional text replacing the generated banner. By default it is built from the tenant's own tag counts: "Demo environment: 1 live tag, 240 simulated animals." |
| `organizations.settings.alert_rules.offline_threshold_hours` | What counts as an offline tag (default 6); used by the pg_cron job **and** by the "Offline tags" card and every stale "last fix" |

Example (an org admin can edit these in the `organizations` row; the logo can live in a Storage bucket):

```json
{ "brand_settings": { "accent": "#1F4E79" },
  "settings": { "timezone": "Asia/Dubai", "demo_mode": false, "alert_rules": { "offline_threshold_hours": 12 } } }
```

**Scope selector.** The region and branch menus in the top bar are loaded from the tenant's own `regions` and `branches` (`GET /api/scope`, filtered by Row Level Security). Choosing one scopes the whole app: KPIs, the bell, the map, the alert feed, Animals and Alerts. The choice is remembered per organization in the browser. A regional manager's region and a branch officer's branch are shown locked; the selector only ever narrows, and the database still decides what a user may see.

**Components.** The twelve components of DESIGN.md §8 live once in `src/components/ui` (KPI card, status pill, data table, animal drawer frame, alert feed item, filter bar, buttons, toast, battery and signal glyphs, timestamp, map popup, and the loading / empty / error states). Screens are assembled from them; `tests/shell-guards.test.ts` fails if a screen grows its own copy, a hex colour, a looping animation or a hardcoded tenant name.

**Every screen has the three states.** Loading is a cream skeleton (a static one: the product has exactly one looping animation, the pulse on an unacknowledged breach); empty is one sentence and one action; failed says what failed and offers **Try again**. `src/app/(app)/error.tsx` and `loading.tsx` cover the rest.

## Map

The map is Google Maps (vector, cloud-styled Map ID), loaded once per page with `region=PK`.

- **Setup, style and key protection:** [docs/MAP_STYLE.md](MAP_STYLE.md) has the exact style settings to apply in Google Cloud Console, how to restrict the browser key to your domains, and a manual checklist to run once with a real key.
- **Default view:** the tenant's service area, with **Punjab**, **Pakistan** and **Fit to all animals** buttons; there is no world view (the camera is restricted to the country plus a margin). The areas are tenant data, not constants. Set them per organization in `organizations.settings`:

  ```json
  { "map": {
      "service_area": { "south": 27.7, "west": 69.9, "north": 33.9, "east": 75.5, "label": "Punjab" },
      "country":      { "south": 23.6, "west": 60.9, "north": 37.1, "east": 77.8, "label": "Pakistan" } } }
  ```

  Missing or invalid values fall back to those defaults. The button labels come from `label`.
- **Pins and clusters:** one pin per animal; below zoom 10 they cluster, and a cluster that contains a breach always shows a crimson ring and a breach count.
- **Boundaries:** district outlines come from PostGIS (`npm run import:boundaries`).
- **Geofences:** organization admins draw and edit polygon and radius fences on the Geofences page (terra-draw); the shape is stored as PostGIS geometry and validated in the database.
- **Trail:** an animal's drawer has **Show trail** (24 h or 7 days, dots and a line, with a playback slider).
- **Cost:** Google bills a "map load" for each map created: the Overview, each opened animal drawer and the geofence dialog. Set a budget alert and a daily quota (see MAP_STYLE.md).

## Row Level Security

Defined in `supabase/migrations/20261009000005_rls_policies.sql`. RLS is on for every table; an `authenticated` user can only do what a policy allows, and `anon` can do nothing.

**Model**

| Who | Reads | Writes |
|---|---|---|
| Member of an organization | only their organizations, only while the organization is active | see below |
| `org_admin` | the whole organization | alerts, **and** users (memberships), geofences, regions, branches, borrowers, loans, tags, animals, organization name / branding / settings |
| `regional_manager` | branches of their region | acknowledge / assign / resolve alerts in their region |
| `branch_officer` | their branch | acknowledge / assign / resolve alerts in their branch |
| `auditor` | the whole organization | nothing |
| platform admin | every organization, via an explicit `is_platform_admin()` clause (not by bypassing RLS) | nothing |

Users also edit their own profile (name, phone). Fixes are written only by ingestion (service role). Alert audit events are append-only, and the actor must be the caller.

**Helper functions** (`SECURITY DEFINER`, empty `search_path`, answer only about the caller): `current_org_ids()`, `has_role(org, role)`, `has_any_role(org, roles[])`, `can_see_whole_org(org)`, `user_branch_scope()` (the branch ids the caller may see), `org_member_ids()`, `is_platform_admin()`.

**Privileges are an allow-list.** The migration ends with explicit `GRANT`s, including column-level ones (alerts: only the workflow columns; organizations: only name, logo, branding, settings; memberships: only role, region, branch). A later migration must **not** blanket `revoke ... from authenticated`, or it will wipe them.

**Gotcha:** a refused `UPDATE` / `DELETE` is not an error, it simply matches zero rows. Code that writes must ask for the row back (`.select("id")`) and treat an empty result as "not allowed". The alert lifecycle and geofence routes do.

**Keep `src/lib/permissions.ts` in step.** It mirrors these policies for the app. A test runs every role against every permission on the real policies and fails if the two ever disagree.

## Tests

```powershell
npm test                 # everything (about 6 seconds)
npm run test:db          # only the database tests (RLS, ingestion, realtime, background jobs)
```

`tests/db/rls.test.ts` proves, as real end users, that: a Demo Bank user cannot read a single Bank of Punjab row (every table and view, by id, and for writes); an auditor cannot update, insert or delete anything; a branch officer cannot see another branch; a regional manager cannot see another region; the role x permission matrix in `permissions.ts` equals what the database allows; platform admins read across organizations but write nothing; audit events cannot be forged or edited; immutable columns are protected; anonymous access is refused. A negative control switches RLS off and checks the isolation query then *does* see the other tenant, so the checks cannot pass vacuously.

**Where they run.** By default on **PGlite**, a real PostgreSQL engine running in-process: no Docker, nothing to install, no network. PGlite has no PostGIS, so for that backend the spatial types are replaced by small text stubs (`tests/db/backend.ts`); the policies do not depend on geometry. To run the *same* tests against a Supabase test project or a local `supabase start` database, give it a direct connection string (migrations already applied):

```powershell
$env:TEST_DATABASE_URL = "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
npm run test:db
```

All fixtures and attempts happen inside one transaction that is rolled back, but use a disposable project anyway. This path has not been run against a live project.

## Database workflow

```powershell
npx supabase migration new <name>   # creates supabase/migrations/<timestamp>_<name>.sql
npx supabase db push                # apply to the linked project
npm run types:gen                   # refresh src/types/database.ts
```

Every migration that creates a table must also enable RLS on it. `supabase start` and `supabase db reset` need Docker and are not part of this workflow.

### Re-seeding

The seed never deletes. To start over, run this in the SQL Editor (keeps `district_boundaries`, `organizations`, `profiles` and `memberships`), then seed again:

```sql
truncate table public.alert_events, public.alerts, public.fixes, public.animal_geofence,
  public.animals, public.tags, public.loans, public.borrowers,
  public.branches, public.regions, public.geofences restart identity cascade;
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| API routes return 503 and the log says `NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set` | `.env.local` is missing or incomplete. Restart `npm run dev` after editing it. |
| `relation "public.…" does not exist` / `Could not find the table … in the schema cache` | Migrations not applied: run `npx supabase db push`. |
| `Could not find the function public.… in the schema cache` right after a push | Reload the API schema: run `notify pgrst, 'reload schema';` in the SQL Editor. |
| The dashboard is empty / KPI cards show zeros | Schema is applied but nothing is seeded (step 5), or the signed-in organization has no animals (Demo Bank has 14). |
| Sign-in says "Incorrect email or password." for a seeded test account | Run `npm run seed:accounts` (step 7). It needs the migrations and `supabase/seed.sql` applied first. |
| After sign-in you land back on `/login?error=no_access` | The user has no membership in an active organization. Add one (see "Add a member"). |
| The reset or invitation link says "This link has expired" | Links work once. Check the Site URL / Redirect URLs (step 6), and request a new link. The browser console shows `[reset-password] link rejected: <reason>`. |
| `permission denied for table …` / error code `42501` from the API | Row Level Security (or a missing grant) refused it. Check the user's role in `memberships`, and that migration 5 is applied. |
| An update "succeeds" but nothing changes | RLS matched zero rows (no error is raised). Confirm the role may do it; code should request the row back with `.select()`. |
| The top bar stays on **Connecting…** or **Reconnecting…**, nothing updates live | Realtime is not delivering. Check that migration 7 was applied (**Database → Publications → supabase_realtime** lists `fixes`, `alerts`, `animals`), that **Realtime** is not disabled for the project (Project Settings → Realtime), that the browser can open WebSockets to `<ref>.supabase.co` (corporate proxies sometimes block them), and that you are signed in (the socket uses your session). The dashboard still works by reloading. |
| Tags never show as offline, or `/api/health` says `background_jobs` is `unknown`, `stale` or `failing` | pg_cron is not running the jobs. Check `select jobname, schedule from cron.job;` (two `bovinesense-…` rows) and `select status, return_message from cron.job_run_details order by start_time desc limit 10;`. If the jobs are missing, enable **Database → Extensions → pg_cron** and run `select public.schedule_background_jobs();`. |
| Requests are redirected to `/login` in a loop | The Supabase env vars are missing in the browser build: `NEXT_PUBLIC_*` values are baked in at build time, so rebuild after changing them. |
| Map shows no district outlines | Run `npm run import:boundaries`. |
| Map area says it is unavailable | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` or `NEXT_PUBLIC_GOOGLE_MAP_ID` is empty. Restart `npm run dev` after editing `.env.local` (these values are baked in at build time). |
| "Google Maps rejected the API key" | The site's address is not in the key's HTTP-referrer list, or the Maps JavaScript API is not enabled for the key. See docs/MAP_STYLE.md. |
| `npm run import:boundaries` says env vars are missing | The script reads `.env.local` then `.env` from the project root. |

## Useful commands

```powershell
npm run dev            # dev server
npm run build          # production build
npm run lint
npm test               # unit tests
npx tsc --noEmit       # typecheck
npm run seed:accounts          # dev test users (docs/TEST_ACCOUNTS.md)
npm run seed:accounts:remove   # delete them
npm run test:db        # database / RLS tests only
npm run invite -- <email> ...  # invite a real user
```

## Folder structure

- `src/app/` — pages and API route handlers (thin; they query views/functions through Supabase).
- `src/components/` — shell, overview, map and alert components.
- `src/proxy.ts` — session refresh and route protection (Next 16 "proxy", formerly middleware).
- `src/lib/auth/` — roles and permissions, access resolution, the API guard, Server Actions.
- `src/lib/supabase/` — `browser.ts`, `server.ts` (anon key + session), `admin.ts` (service role, server-only), `result.ts` helpers.
- `src/lib/alerts/` — alert rules (pure, tested), engine and lifecycle.
- `src/types/database.ts` — Supabase schema types.
- `supabase/` — `config.toml`, `migrations/`, `seed.sql`, `tests/` (constraint checks).
- `scripts/` — boundary import and GPS simulator (they use `scripts/lib/supabase.ts`).
- `data/` — district boundary GeoJSON input.
- `tests/` — unit tests.
- `docs/` — design, architecture and audit documents.

> `db/schema.ts`, `drizzle/` and `drizzle.config.ts` are the superseded Drizzle definitions of the same schema. They are no longer used and are pending removal.
