# Manual click-through test (15 items)

Run this on the deployed site (or `npm run dev`) after seeding: migrations applied, `supabase/seed.sql`, `npm run seed:accounts`, and a device key. Accounts and the shared password are in [TEST_ACCOUNTS.md](TEST_ACCOUNTS.md). Tick each box; write down what you saw if it fails.

Setup for the live items: terminal with `$env:DEVICE_API_KEY` set to a Bank of Punjab device key and `$env:INGEST_URL` pointing at the site.

## Sign-in and roles

- [ ] **1. Signed out.** Open `/` and `/alerts` in a private window: both send you to `/login`. `/api/kpi` answers 401, not data.
- [ ] **2. Org admin.** Sign in as `org-admin.bop@…`. You land on Bank of Punjab with no organization picker. The top bar shows "Bank of Punjab" and "Powered by BovineSense". KPI "Animals monitored" reads 240 (241 if the real tag is reserved). The sidebar shows Settings.
- [ ] **3. Regional manager.** `regional-manager.bop@…`: the scope selector is locked to *Central Punjab*; Settings is not in the sidebar; Geofences has "New geofence" disabled.
- [ ] **4. Branch officer.** `branch-officer.bop@…`: scope locked to *Lahore Main*; only Lahore animals and alerts appear.
- [ ] **5. Auditor.** `auditor.bop@…`: browse everything; on an alert there is no Acknowledge, Assign or Resolve, and no bulk-select checkboxes.

## Isolation

- [ ] **6. Demo Bank sees no Bank of Punjab data.** Sign in as `org-admin.demo@…`: 14 animals, a different logo/name in the top bar, no `LN-2024-LHE-…` loan found by search, and the map shows none of the 240. Copy an animal id from a Bank of Punjab session and open `/api/animals/<id>` while signed in as Demo Bank: it answers 404.
- [ ] **7. Platform admin / two memberships.** `auditor.both@…` gets the organization picker and is read-only in each organization; switching changes every number on screen.

## Live data

- [ ] **8. Live breach within 10 s.** As org admin on the Overview, in a terminal run `npm run simulate -- --scenario=breach --org bank-of-punjab --key $env:DEVICE_API_KEY`. Note the time. A breach toast, the red pulsing pin and a feed card appear **within 10 seconds of the first fix that crosses the limit** (the walk itself takes a few minutes; the clock starts at the alert-causing fix printed by the simulator as "Alert raised"). KPI "Active breaches" goes up by one without a page reload.
- [ ] **9. Fast movement.** Stop the simulator, run `--scenario=fast-movement`. A "Fast movement" alert appears; it does not repeat on every fix.

## Alert lifecycle

- [ ] **10. Acknowledge → assign.** On the new breach card click **Acknowledge** (the dot disappears), then **Assign** and pick the Lahore branch officer (only branch officers of that animal's branch are offered). Open the alert on `/alerts`: the audit trail lists both steps with your name and times.
- [ ] **11. Assigned person sees it; resolve needs a reason.** In a second browser as `branch-officer.bop@…` the alert shows state *Assigned*. Click **Resolve** without choosing a reason: it refuses. Choose *Escalated to recovery*, add a note, Resolve: the alert leaves the open feed, the trail shows reason and note. Confirm the breach never closed by itself while you waited.

## Map, fences, search

- [ ] **12. Fence drawing.** As org admin: Geofences, **New geofence**, Custom polygon, **Draw on map**; click four corners, finish. Create. The fence appears on the map and in the list. Then **Assign animals**, tick one, Save: the list shows "1 animal". Edit the fence, change the warning buffer, Save: the list shows the new buffer. Try the radius type too (click the centre, then a second click for the radius).
- [ ] **13. Search and drawer.** Type a loan ID in the top search: the map flies to the animal and the 420 px drawer opens. Click through the four tabs (Location, Borrower and loan, Tag health, Events). **Show trail** draws a line and the slider scrubs it. Click a different pin: the drawer switches to that animal.

## Export, devices, limits

- [ ] **14. CSV export.** Alerts: set a From/To range that includes today and pick a branch; the table narrows. **Export CSV** downloads a file that opens in Excel with the same rows (one header row, readable times). With a range that has no alerts the file has only the header.
- [ ] **15. Devices and the ingest limit.** Devices lists tags with battery, signal and last contact; unassigned tags come first. As org admin, create a device key: it is shown once and not again after you close the dialog; revoke it and the simulator using it stops with "device key was rejected". Finally, `curl` `/api/ingest/fix` 40 times with a made-up key (`bsk_` followed by letters/digits): the first answers are 401, later ones 429.

## Record

| Date | Tester | Build / commit | Items failed | Notes |
|---|---|---|---|---|
| | | | | |
