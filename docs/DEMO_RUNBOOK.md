# Demo runbook (one page)

Bank of Punjab demo, about 10 minutes. The climax is the live breach of the real tag. Steps follow [DESIGN.md §10](DESIGN.md).

## Before the demo (do this the day before, and again 30 minutes before)

- [ ] Deployed app opens; `/api/health` says `ok`. Migrations applied, `supabase/seed.sql` run, `npm run import:boundaries` done.
- [ ] Demo logins exist: `npm run seed:accounts` (list and password in [TEST_ACCOUNTS.md](TEST_ACCOUNTS.md)).
- [ ] Demo exceptions loaded: run `supabase/seed_demo_state.sql` once (SQL Editor). The Overview then shows 4 breaches, 10 near boundary, 2 fast movement and 5 offline across the 240 animals. The simulator leaves those animals alone, so the picture stays while the rest drift.
- [ ] Real tag reserved: set `REAL_TAG_SERIAL` in `.env.local`, run `npm run seed:real-tag`. The banner should read "Demo environment: 1 live tag, 240 simulated animals."
- [ ] One **persistent device key** for the demo, used for the simulator and the real tag: `npm run device-key -- create --org bank-of-punjab --label "Demo"`. Copy it once into your terminal as `$env:DEVICE_API_KEY` (and the tag's gateway). Using `--key` matters: a simulator started *without* a key revokes the previous temporary key, so two simulators would knock each other out.
- [ ] `$env:INGEST_URL = "https://<your-app>.vercel.app/api/ingest/fix"` in the terminal you will demo from.
- [ ] Start normal drift and leave it running in terminal 1: `npm run simulate -- --org bank-of-punjab`. Every pin should say "last fix" a few minutes ago, not hours.
- [ ] The real tag has sent at least one fix **from the room** and shows on the map (status Inside). Test it **at the venue**, by a window.
- [ ] Browser: signed in as `org-admin.bop@…`, Overview open, window sized for the projector. A second browser or profile signed in as `branch-officer.bop@…` is open on Alerts, ready for step 5.
- [ ] Offline-safe copies: a screenshot of the Overview and one downloaded Alerts CSV, in case the network fails.
- [ ] Google Maps key restricted to the deployed address ([DEPLOY.md](DEPLOY.md) §4) and the map draws.

## Logins

| Use | Account | Why |
|---|---|---|
| Presenter | `org-admin.bop@bovinesense.test` | sees all 240, can draw fences |
| Assignee | `branch-officer.bop@bovinesense.test` | Lahore Main branch; the only person the alert can be assigned to |
| If asked about access | `auditor.bop@bovinesense.test` | read-only; every action is refused |
| If asked about tenants | `org-admin.demo@bovinesense.test` | Demo Bank: sees none of Bank of Punjab's data |

## The 7 steps

| # | Step (time) | What you do | Simulator command |
|---|---|---|---|
| 1 | Bank-wide picture (1 min) | Overview opens on Punjab. Read the four KPIs: animals monitored, inside boundary, active breaches, offline tags. | Terminal 1 already running: `npm run simulate -- --org bank-of-punjab --key $env:DEVICE_API_KEY` |
| 2 | Find a loan (1 min) | Type a loan ID (try `LN-LIVE-0001`, or any `LN-2024-…`) in the top search. The map flies to it and the drawer opens. | none |
| 3 | History (1 min) | In the drawer, **Show trail**, choose 24 h, scrub the slider. A freshly seeded animal has few fixes; the simulator's drift builds the trail while you talk. | none (terminal 1 keeps adding fixes) |
| 4 | Draw a fence (2 min) | Geofences, **New geofence**, Custom polygon, **Draw on map** around the room, name it, Create. Then the people icon on that fence, **Assign animals**, tick *Live demo animal*, Save. Wait for one fix from the tag inside the room (status Inside). | none |
| 5 | Live breach (2 min) | A teammate walks the tag out of the room. The toast, the pulse and the feed card appear. **Acknowledge**, then **Assign** to the Lahore branch officer. | none (real tag). Backup: `npm run simulate -- --scenario=breach --org bank-of-punjab --key $env:DEVICE_API_KEY` (replaces terminal 1; see below) |
| 6 | Fast movement (1 min) | A critical "Fast movement" alert appears for one animal moving at about 40 km/h. Explain: a vehicle speed is how an unauthorised sale looks. | `npm run simulate -- --scenario=fast-movement --org bank-of-punjab --key $env:DEVICE_API_KEY` |
| 7 | Close the loop (2 min) | Resolve the breach with a reason (for example *Escalated to recovery*) and a note; show the audit trail on the alert. **The daily breach PDF is not built yet.** Instead open Alerts, set today's date, and **Export CSV**; open it in Excel. | none |

Each scenario command replaces normal drift: stop terminal 1 (Ctrl+C), run the scenario, and start normal drift again afterwards. Scenarios affect the first simulated animals (the breach walks one Lahore animal out of its district at about 1.5 km per 8 s tick, so allow two to four minutes for the first alert; start it before you need it). The real tag is never moved by the simulator.

## Backup plan: the real tag gets no GPS fix indoors

Decide at step 4, not at step 5. If the tag has not shown a fresh fix within 30 seconds of being by the window:

1. **Carry on with the simulator.** Say it plainly: "This is a simulated animal behaving the way the tag will." Start `--scenario=breach` about three minutes **before** step 5 so the alert is already building; it appears with the same toast, pulse and feed card.
2. **Hand-send a fix for the real tag** (proves the pipeline is live): from a terminal, `POST` to `$env:INGEST_URL` with header `x-api-key: $env:DEVICE_API_KEY` and body `{"tag_serial":"<REAL_TAG_SERIAL>","lat":…,"lon":…,"fixed_at":"<now, ISO with offset>"}`. Send one inside the fence, then two outside it (two consecutive outside fixes, or one fix more than 200 m outside, raises the breach).
3. Never show an old position as current: the app labels a stale pin with its age. If asked, point at it.
4. If the network or the site is down: use the screenshot and the CSV from the checklist and talk through the flow.

## Afterwards

- [ ] Ctrl+C the simulator. Revoke the demo device key (Devices screen).
- [ ] `npm run seed:accounts:remove` if the project will hold real data.
