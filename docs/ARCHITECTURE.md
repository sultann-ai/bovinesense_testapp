# Architecture

## Data flow

1. A real tag or `scripts/simulate.ts` sends a GPS fix to `POST /api/ingest/fix`.
2. The route validates the JSON body and looks up the per-organization **device key** (`X-Api-Key`, stored as a SHA-256 hash in `device_api_keys`).
3. The route calls the Postgres function `ingest_fix()` (service role). In one transaction it resolves the tag **inside the key's organization**, inserts the fix with PostGIS geometry, runs the alert rules, writes alerts and audit events, and updates animal/tag state. The route then emits fix/alert events from the function's result.
4. Supabase Realtime streams the rows that transaction wrote (`postgres_changes` on `fixes`, `alerts` and `animals`) to every subscribed browser, **only to users whose Row Level Security lets them read the row**.
5. One `RealtimeProvider` in the app layout subscribes (filtered by the active organization), shows the Live / Reconnecting state in the top bar, and updates marker positions, KPIs, the alert feed, the bell badge and toasts. After every reconnect it makes each screen refetch, because Realtime does not replay missed changes.

There is no in-process event bus and no SSE route: they were removed with the realtime module, so the live path works on any number of server instances and on serverless hosting.

## Database tables

- `regions` — regional organizational units.
- `branches` — branches belonging to regions.
- `organizations`, `profiles`, `memberships` — tenants, people, and each person's role with an optional region or branch scope.
- `borrowers` — borrower identity and branch data.
- `loans` — borrower loans and amounts.
- `district_boundaries` — imported PostGIS administrative boundary polygons.
- `geofences` — district, polygon, or radius fence geometries and warning buffers.
- `device_api_keys` — per-organization ingestion keys (SHA-256 hash only, label, last used, revoked).
- `fix_daily_summary` — one row per animal per local day (count, first/last position, max speed), written by the nightly retention job from fixes older than the organization's retention window (30 days by default).
- `tags` — physical or simulated tag records and last-seen timestamps.
- `animals` — financed animals, ownership, loan, branch, district, and status.
- `animal_geofence` — active fence assignments for animals.
- `fixes` — GPS positions, timestamps, speed, battery, signal, and simulation flag.
- `alerts` — alert type, severity, lifecycle, details, and resolution fields.
- `alert_events` — alert status-change audit records.

## Alert rules

The rules run in PL/pgSQL inside `ingest_fix()` (`supabase/migrations/20261009000006_ingestion.sql`). The thresholds below are **defaults**; each organization can override them in `organizations.settings -> 'alert_rules'` (`hard_breach_metres`, `breach_consecutive_fixes`, `speed_threshold_kmh`, `low_battery_pct`). The warning buffer is per fence. Tests with fixed coordinates: `tests/db/ingest.test.ts`.

- **Breach:** outside the active fence for 2 consecutive fixes (the immediately preceding ones), or at least 200 metres outside on one fix. Raised once per breach.
- **Near boundary:** inside the fence and nearer than the fence's warning buffer; the default buffer is 500 metres. A single outside fix below 200 metres also raises a near-boundary alert when the animal was not already near or in breach.
- **Fast movement:** speed strictly greater than 15 km/h. If the tag does not provide speed, it is computed from the previous fix. One open alert at a time.
- **Low battery:** battery strictly below 20%. One open alert at a time.
- **Returned:** a previously breached animal is inside again; the breach remains open for manual resolution.
- **Tag offline:** no fix for 6 hours by default (`alert_rules.offline_threshold_hours`, per organization). Not part of ingestion: `check_offline_tags()` runs every 15 minutes under pg_cron, per organization, with that organization's threshold.

A fix older than the animal's newest fix is kept as history and changes nothing; a retransmitted fix (same tag and timestamp) is accepted once.

## Ingestion API

`POST /api/ingest/fix`

Authentication: send an organization's device key (`bsk_…`, created on the Devices screen) in the `X-Api-Key` header. The key decides the organization; the tag must belong to it.

Example request:

```http
POST http://localhost:3000/api/ingest/fix
X-Api-Key: <device key>
Content-Type: application/json
```

```json
{
  "tag_serial": "SIM-00001",
  "lat": 31.52,
  "lon": 74.36,
  "fixed_at": "2026-10-09T14:32:00Z",
  "speed_kmh": 0.8,
  "battery_pct": 82,
  "signal_bars": 4
}
```

Success returns `201` with `fix_id`, `animal_id`, and `alerts_raised`. Invalid JSON or fields return `400`; a missing, unknown or revoked key returns `401`; a tag that is not in the key's organization, or has no animal, returns `404`. A retransmitted fix returns `201` again with `alerts_raised: 0`.
