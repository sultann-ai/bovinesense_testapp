/**
 * Background work: offline detection, data retention (daily summaries), scheduling, the index
 * review and the health helpers (supabase/migrations/20261009000008_background_jobs.sql).
 *
 * Runs on PGlite by default. pg_cron itself is not available there, so a stand-in `cron` schema
 * records what is scheduled (tests/db/backend.ts); the job functions are called directly. With
 * TEST_DATABASE_URL against a real project the scheduling tests use the real pg_cron tables.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, probe, refused, type Query, type Row, type TestDb } from "./backend";
import { seedFixtures, type Fixtures } from "./fixtures";

let db: TestDb;
let q: Query;
let fx: Fixtures;

beforeAll(async () => {
  db = await createTestDb();
  q = db.query;
  await q("begin");
  fx = await seedFixtures(q);
});
afterAll(async () => {
  await q("rollback");
  await db.close();
});

// ─── helpers ─────────────────────────────────────────────────────────────────────────────────────
interface Org { id: string; keyId: string; branchId: number; borrowerId: number; loanId: number }
interface Animal { org: Org; serial: string; tagId: number; animalId: number }

let seq = 0;
const next = () => ++seq;
const one = async (sql: string, params?: unknown[]): Promise<Row> => (await q(sql, params)).rows[0];
const num = async (sql: string, params?: unknown[]) => Number((await one(sql, params)).n);

async function makeOrg(slug: string, settings: unknown = {}, status = "active"): Promise<Org> {
  const id = (
    await one("insert into public.organizations (name, slug, settings, status) values ($1, $2, $3::jsonb, $4) returning id", [slug, slug, JSON.stringify(settings), status])
  ).id as string;
  const regionId = (await one("insert into public.regions (organization_id, name, code) values ($1, 'R', 'R1') returning id", [id])).id as number;
  const branchId = (await one("insert into public.branches (organization_id, name, code, region_id) values ($1, 'B', 'B1', $2) returning id", [id, regionId])).id as number;
  const borrowerId = (await one("insert into public.borrowers (organization_id, name, cnic, branch_id) values ($1, 'Ali Khan', $2, $3) returning id", [id, `C-${next()}`, branchId])).id as number;
  const loanId = (await one("insert into public.loans (organization_id, loan_number, borrower_id, branch_id, amount_pkr) values ($1, 'LN-1', $2, $3, 1000) returning id", [id, borrowerId, branchId])).id as number;
  const keyId = (await one("insert into public.device_api_keys (organization_id, key_hash, key_prefix, label) values ($1, $2, 'bs_t', 'k') returning id", [id, next().toString(16).padStart(2, "0").repeat(32)])).id as string;
  return { id, keyId, branchId, borrowerId, loanId };
}

async function addAnimal(org: Org, opts: { seenHoursAgo?: number | null; enrolledHoursAgo?: number; fence?: boolean } = {}): Promise<Animal> {
  const serial = `T-${org.id.slice(0, 4)}-${next()}`;
  const tagId = (await one("insert into public.tags (organization_id, serial_number) values ($1, $2) returning id", [org.id, serial])).id as number;
  if (opts.seenHoursAgo !== undefined && opts.seenHoursAgo !== null) {
    await q("update public.tags set last_seen_at = now() - make_interval(secs => $2) where id = $1", [tagId, opts.seenHoursAgo * 3600]);
  }
  const animalId = (
    await one(
      `insert into public.animals (organization_id, name, tag_id, borrower_id, loan_id, branch_id, status, created_at)
       values ($1, 'Bessie', $2, $3, $4, $5, 'inside', now() - make_interval(secs => $6)) returning id`,
      [org.id, tagId, org.borrowerId, org.loanId, org.branchId, (opts.enrolledHoursAgo ?? 1000) * 3600],
    )
  ).id as number;
  if (opts.fence) {
    const fenceId = (
      await one(
        "insert into public.geofences (organization_id, name, type, geom) values ($1, 'f', 'polygon', extensions.st_makeenvelope(74.3, 31.5, 74.4, 31.6, 4326)) returning id",
        [org.id],
      )
    ).id as number;
    await q("insert into public.animal_geofence (organization_id, animal_id, geofence_id, is_active) values ($1, $2, $3, true)", [org.id, animalId, fenceId]);
  }
  return { org, serial, tagId, animalId };
}

const statusOf = async (a: Animal) => (await one("select status from public.animals where id = $1", [a.animalId])).status as string;
const offlineAlerts = async (a: Animal) =>
  (await q("select id, severity, status, title, detail from public.alerts where animal_id = $1 and type = 'tag_offline' order by id", [a.animalId])).rows;
const checkAll = async (orgId: string | null = null) => Number((await one("select public.check_offline_tags($1::uuid) as n", [orgId])).n);

// ─── offline detection ───────────────────────────────────────────────────────────────────────────
describe("check_offline_tags", () => {
  it("flags a tag silent for more than the default 6 h, and only that one", async () => {
    const org = await makeOrg("off-default");
    const fresh = await addAnimal(org, { seenHoursAgo: 5 });
    const silent = await addAnimal(org, { seenHoursAgo: 7 });
    expect(await checkAll(org.id)).toBe(1);
    expect(await statusOf(fresh)).toBe("inside");
    expect(await statusOf(silent)).toBe("stale");

    const [alert] = await offlineAlerts(silent);
    expect(alert).toMatchObject({ severity: "warning", status: "new", title: "Tag offline" });
    expect(alert.detail as string).toContain("No fix in 6 h");
    expect(alert.detail as string).toContain("Bessie (Ali Khan)");
    expect(alert.detail as string).toContain("LN-1");
    expect(await offlineAlerts(fresh)).toEqual([]);
  });

  it("writes the audit event for the alert (system-created, no user)", async () => {
    const org = await makeOrg("off-audit");
    const a = await addAnimal(org, { seenHoursAgo: 9 });
    await checkAll(org.id);
    const [alert] = await offlineAlerts(a);
    const ev = await one("select from_status, to_status, user_id from public.alert_events where alert_id = $1", [alert.id]);
    expect(ev).toMatchObject({ from_status: null, to_status: "new", user_id: null });
  });

  it("uses each organization's own threshold, in one run", async () => {
    const defaults = await makeOrg("off-org-default");
    const strict = await makeOrg("off-org-strict", { alert_rules: { offline_threshold_hours: 2 } });
    const lenient = await makeOrg("off-org-lenient", { alert_rules: { offline_threshold_hours: 12 } });
    const a = await addAnimal(defaults, { seenHoursAgo: 3 });
    const b = await addAnimal(strict, { seenHoursAgo: 3 });
    const c = await addAnimal(lenient, { seenHoursAgo: 8 });
    const before = [a, b, c];

    await checkAll(null); // every organization
    expect(await statusOf(a)).toBe("inside"); // 3 h < 6 h
    expect(await statusOf(b)).toBe("stale"); // 3 h > 2 h
    expect(await statusOf(c)).toBe("inside"); // 8 h < 12 h
    expect(before).toHaveLength(3);
  });

  it("can be run for a single organization, leaving the others alone", async () => {
    const one1 = await makeOrg("off-single-a");
    const two = await makeOrg("off-single-b");
    const a = await addAnimal(one1, { seenHoursAgo: 10 });
    const b = await addAnimal(two, { seenHoursAgo: 10 });
    expect(await checkAll(one1.id)).toBe(1);
    expect(await statusOf(a)).toBe("stale");
    expect(await statusOf(b)).toBe("inside");
  });

  it("writes a fractional threshold plainly: 1.5 h", async () => {
    const org = await makeOrg("off-frac", { alert_rules: { offline_threshold_hours: 1.5 } });
    const a = await addAnimal(org, { seenHoursAgo: 2 });
    await checkAll(org.id);
    expect((await offlineAlerts(a))[0].detail as string).toContain("No fix in 1.5 h");
  });

  it("falls back to 6 h for an invalid threshold (a string, zero, below the 1 h minimum, null)", async () => {
    for (const bad of ["soon", 0, 0.5, -3, null]) {
      const org = await makeOrg(`off-bad-${next()}`, { alert_rules: { offline_threshold_hours: bad } });
      expect(Number((await one("select public.org_offline_threshold_hours($1) as n", [org.id])).n), String(bad)).toBe(6);
    }
    const org = await makeOrg("off-bad-run", { alert_rules: { offline_threshold_hours: "soon" } });
    const a = await addAnimal(org, { seenHoursAgo: 5 });
    await checkAll(org.id);
    expect(await statusOf(a)).toBe("inside");
  });

  it("is idempotent: a second run finds nothing new and raises no second alert", async () => {
    const org = await makeOrg("off-idem");
    const a = await addAnimal(org, { seenHoursAgo: 8 });
    expect(await checkAll(org.id)).toBe(1);
    expect(await checkAll(org.id)).toBe(0);
    expect(await offlineAlerts(a)).toHaveLength(1);
  });

  it("does not flag a tag that has never reported until the animal has been enrolled that long", async () => {
    const org = await makeOrg("off-never");
    const newcomer = await addAnimal(org, { seenHoursAgo: null, enrolledHoursAgo: 1 });
    const old = await addAnimal(org, { seenHoursAgo: null, enrolledHoursAgo: 10 });
    await checkAll(org.id);
    expect(await statusOf(newcomer)).toBe("inside");
    expect(await statusOf(old)).toBe("stale");
  });

  it("brings an animal back when its tag reports again, and does not duplicate an open offline alert", async () => {
    const org = await makeOrg("off-revive");
    const a = await addAnimal(org, { seenHoursAgo: 9, fence: true });
    await checkAll(org.id);
    expect(await statusOf(a)).toBe("stale");

    // the tag reports from inside its fence: back to inside (ingest_fix handles it)
    await q(
      "select public.ingest_fix($1::uuid, $2::uuid, $3::text, 31.55::float8, 74.35::float8, now(), 2::float8, 80, 3)",
      [org.id, org.keyId, a.serial],
    );
    expect(await statusOf(a)).toBe("inside");

    // silent again while the first alert is still open: stale again, but one open alert only
    await q("update public.tags set last_seen_at = now() - interval '9 hours' where id = $1", [a.tagId]);
    await checkAll(org.id);
    expect(await statusOf(a)).toBe("stale");
    expect(await offlineAlerts(a)).toHaveLength(1);

    // once a person has resolved it, the next outage raises a new one
    await q("update public.alerts set status = 'resolved' where animal_id = $1 and type = 'tag_offline'", [a.animalId]);
    await q("update public.animals set status = 'inside' where id = $1", [a.animalId]);
    await checkAll(org.id);
    expect(await offlineAlerts(a)).toHaveLength(2);
  });

  it("skips suspended organizations", async () => {
    const org = await makeOrg("off-suspended", {}, "suspended");
    const a = await addAnimal(org, { seenHoursAgo: 20 });
    await checkAll(null);
    expect(await statusOf(a)).toBe("inside");
  });

  it("one organization failing never stops the others, and leaves the failed one untouched", async () => {
    const bad = await makeOrg("off-fail-a");
    const good = await makeOrg("off-fail-b");
    const a = await addAnimal(bad, { seenHoursAgo: 10 });
    const b = await addAnimal(good, { seenHoursAgo: 10 });
    await q(`create function public.test_fail_alert() returns trigger language plpgsql as $$
             begin if new.organization_id = '${bad.id}' then raise exception 'boom'; end if; return new; end $$`);
    await q("create trigger test_fail_alert before insert on public.alerts for each row execute function public.test_fail_alert()");
    try {
      await checkAll(null);
    } finally {
      await q("drop trigger test_fail_alert on public.alerts");
      await q("drop function public.test_fail_alert()");
    }
    expect(await statusOf(b)).toBe("stale"); // processed
    expect(await statusOf(a)).toBe("inside"); // rolled back as a unit, not half done
    expect(await offlineAlerts(a)).toEqual([]);
  });
});

// ─── retention and daily summaries ───────────────────────────────────────────────────────────────
// "Now" is fixed: 2026-10-10 12:00 UTC = 17:00 in Pakistan (UTC+5). With 30 days kept, the oldest
// kept local day is 2026-09-10, which starts at 2026-09-09 19:00 UTC.
const NOW = "2026-10-10T12:00:00Z";
const rollup = async (orgId: string | null, now = NOW, maxDays = 60) =>
  Number((await one("select public.rollup_and_prune_fixes($1::uuid, $2::timestamptz, $3::int) as n", [orgId, now, maxDays])).n);

async function fix(a: Animal, at: string, lat = 31.5, lon = 74.3, speed: number | null = null) {
  await q(
    "insert into public.fixes (organization_id, tag_id, animal_id, lat, lon, fixed_at, speed_kmh) values ($1, $2, $3, $4, $5, $6, $7)",
    [a.org.id, a.tagId, a.animalId, lat, lon, at, speed],
  );
}
const rawCount = (a: Animal) => num("select count(*)::int n from public.fixes where animal_id = $1", [a.animalId]);
const summaries = async (a: Animal) =>
  (await q("select * from public.fix_daily_summary where animal_id = $1 order by summary_date", [a.animalId])).rows;
const dateText = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

describe("rollup_and_prune_fixes", () => {
  it("rolls an old day into one summary row: count, first and last position, max speed", async () => {
    const org = await makeOrg("ret-basic");
    const a = await addAnimal(org);
    // 2026-09-08 local (Pakistan): 08:00, 12:00 and 23:30
    await fix(a, "2026-09-08T03:00:00Z", 31.1, 74.1, 3);
    await fix(a, "2026-09-08T07:00:00Z", 31.2, 74.2, 9.5);
    await fix(a, "2026-09-08T18:30:00Z", 31.3, 74.3, 4);
    expect(await rollup(org.id)).toBe(3);
    expect(await rawCount(a)).toBe(0);

    const rows = await summaries(a);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(dateText(r.summary_date)).toBe("2026-09-08");
    expect(r).toMatchObject({ fix_count: 3, first_lat: 31.1, first_lon: 74.1, last_lat: 31.3, last_lon: 74.3, max_speed_kmh: 9.5 });
    expect(new Date(r.first_fix_at as string).toISOString()).toBe("2026-09-08T03:00:00.000Z");
    expect(new Date(r.last_fix_at as string).toISOString()).toBe("2026-09-08T18:30:00.000Z");
  });

  it("keeps the last 30 whole local days exactly: the boundary is local midnight, not UTC", async () => {
    const org = await makeOrg("ret-boundary");
    const a = await addAnimal(org);
    await fix(a, "2026-09-09T10:00:00Z"); // 15:00 on the 9th (Pakistan): old, rolled up
    await fix(a, "2026-09-09T18:59:59Z"); // 23:59:59 on the 9th: old, rolled up
    await fix(a, "2026-09-09T19:00:00Z"); // 00:00:00 on the 10th: the first kept moment
    await fix(a, "2026-09-09T20:00:00Z"); // 01:00 on the 10th: kept (still the 9th in UTC)
    await fix(a, "2026-10-10T08:00:00Z"); // today: kept
    expect(await rollup(org.id)).toBe(2);
    expect(await rawCount(a)).toBe(3);
    const rows = await summaries(a);
    expect(rows.map((r) => dateText(r.summary_date))).toEqual(["2026-09-09"]);
    expect(rows[0].fix_count).toBe(2);
  });

  it("makes one row per animal per day, and keeps animals and days apart", async () => {
    const org = await makeOrg("ret-rows");
    const a = await addAnimal(org);
    const b = await addAnimal(org);
    await fix(a, "2026-08-01T05:00:00Z");
    await fix(a, "2026-08-01T06:00:00Z");
    await fix(a, "2026-08-02T06:00:00Z");
    await fix(b, "2026-08-01T05:00:00Z");
    await rollup(org.id);
    expect((await summaries(a)).map((r) => [dateText(r.summary_date), r.fix_count])).toEqual([["2026-08-01", 2], ["2026-08-02", 1]]);
    expect((await summaries(b)).map((r) => [dateText(r.summary_date), r.fix_count])).toEqual([["2026-08-01", 1]]);
  });

  it("has a retention setting per organization (default 30 days)", async () => {
    const standard = await makeOrg("ret-30");
    const short = await makeOrg("ret-10", { data_retention: { fix_days: 10 } });
    const a = await addAnimal(standard);
    const b = await addAnimal(short);
    await fix(a, "2026-09-25T06:00:00Z"); // 15 days old
    await fix(b, "2026-09-25T06:00:00Z");
    await rollup(null);
    expect(await rawCount(a)).toBe(1); // within 30 days: kept
    expect(await rawCount(b)).toBe(0); // beyond 10 days: rolled up
    expect(await summaries(a)).toEqual([]);
    expect(await summaries(b)).toHaveLength(1);
  });

  it("ignores an invalid retention setting (below the 7-day minimum, wrong type)", async () => {
    for (const bad of [3, 0, -1, "soon", null]) {
      const org = await makeOrg(`ret-bad-${next()}`, { data_retention: { fix_days: bad } });
      expect(Number((await one("select public.org_retention_days($1) as n", [org.id])).n), String(bad)).toBe(30);
    }
    const seven = await makeOrg("ret-seven", { data_retention: { fix_days: 7 } });
    expect(Number((await one("select public.org_retention_days($1) as n", [seven.id])).n)).toBe(7);
  });

  it("rolls up by the organization's timezone, defaulting to Asia/Karachi", async () => {
    const pk = await makeOrg("ret-tz-pk");
    const utc = await makeOrg("ret-tz-utc", { timezone: "UTC" });
    const bogus = await makeOrg("ret-tz-bogus", { timezone: "Mars/Olympus" });
    expect((await one("select public.org_timezone($1) as z", [bogus.id])).z).toBe("Asia/Karachi");
    expect((await one("select public.org_timezone($1) as z", [utc.id])).z).toBe("UTC");

    const a = await addAnimal(pk);
    const b = await addAnimal(utc);
    // 2026-08-20 22:00 UTC is already the 21st in Pakistan, still the 20th in UTC
    await fix(a, "2026-08-20T22:00:00Z");
    await fix(b, "2026-08-20T22:00:00Z");
    await rollup(null);
    expect(dateText((await summaries(a))[0].summary_date)).toBe("2026-08-21");
    expect(dateText((await summaries(b))[0].summary_date)).toBe("2026-08-20");
  });

  it("is idempotent: running again changes nothing", async () => {
    const org = await makeOrg("ret-idem");
    const a = await addAnimal(org);
    await fix(a, "2026-08-01T05:00:00Z", 31.1, 74.1, 5);
    await rollup(org.id);
    const first = await summaries(a);
    expect(await rollup(org.id)).toBe(0);
    expect(await summaries(a)).toEqual(first);
  });

  it("merges a late fix into a day that was already summarised", async () => {
    const org = await makeOrg("ret-late");
    const a = await addAnimal(org);
    await fix(a, "2026-08-01T05:00:00Z", 31.5, 74.5, 4);
    await fix(a, "2026-08-01T09:00:00Z", 31.9, 74.9, 6);
    await rollup(org.id);

    await fix(a, "2026-08-01T01:00:00Z", 31.0, 74.0, 30); // arrives late, earlier than the first
    await fix(a, "2026-08-01T11:00:00Z", 32.0, 75.0, 2); // arrives late, later than the last
    expect(await rollup(org.id)).toBe(2);
    const [r] = await summaries(a);
    expect(r).toMatchObject({ fix_count: 4, first_lat: 31.0, first_lon: 74.0, last_lat: 32.0, last_lon: 75.0, max_speed_kmh: 30 });
    expect(new Date(r.first_fix_at as string).toISOString()).toBe("2026-08-01T01:00:00.000Z");
    expect(new Date(r.last_fix_at as string).toISOString()).toBe("2026-08-01T11:00:00.000Z");
  });

  it("handles fixes with no speed (max speed stays null) and a day of one fix", async () => {
    const org = await makeOrg("ret-nospeed");
    const a = await addAnimal(org);
    await fix(a, "2026-08-01T05:00:00Z", 31.5, 74.5, null);
    await rollup(org.id);
    const [r] = await summaries(a);
    expect(r).toMatchObject({ fix_count: 1, first_lat: 31.5, last_lat: 31.5, max_speed_kmh: null });
  });

  it("bounds one run to p_max_days, oldest first, and a few nights clear a backlog", async () => {
    const org = await makeOrg("ret-backlog");
    const a = await addAnimal(org);
    for (const day of ["01", "02", "03"]) await fix(a, `2026-08-${day}T05:00:00Z`);
    expect(await rollup(org.id, NOW, 1)).toBe(1);
    expect((await summaries(a)).map((r) => dateText(r.summary_date))).toEqual(["2026-08-01"]);
    expect(await rawCount(a)).toBe(2);
    await rollup(org.id, NOW, 1);
    await rollup(org.id, NOW, 1);
    expect(await rawCount(a)).toBe(0);
    expect(await summaries(a)).toHaveLength(3);
  });

  it("removes old fixes that have no animal without a summary, and leaves recent ones", async () => {
    const org = await makeOrg("ret-noanimal");
    const a = await addAnimal(org);
    await q("insert into public.fixes (organization_id, tag_id, animal_id, lat, lon, fixed_at) values ($1, $2, null, 1, 1, '2026-08-01T05:00:00Z')", [org.id, a.tagId]);
    await q("insert into public.fixes (organization_id, tag_id, animal_id, lat, lon, fixed_at) values ($1, $2, null, 1, 1, '2026-10-09T05:00:00Z')", [org.id, a.tagId]);
    expect(await rollup(org.id)).toBe(1);
    expect(await num("select count(*)::int n from public.fixes where organization_id = $1", [org.id])).toBe(1);
    expect(await num("select count(*)::int n from public.fix_daily_summary where organization_id = $1", [org.id])).toBe(0);
  });

  it("never touches another organization's data", async () => {
    const mine = await makeOrg("ret-iso-a");
    const theirs = await makeOrg("ret-iso-b");
    const a = await addAnimal(mine);
    const b = await addAnimal(theirs);
    await fix(a, "2026-08-01T05:00:00Z");
    await fix(b, "2026-08-01T05:00:00Z");
    await rollup(mine.id);
    expect(await rawCount(a)).toBe(0);
    expect(await rawCount(b)).toBe(1);
    expect(await summaries(b)).toEqual([]);
  });

  it("is all-or-nothing per organization: if the summary cannot be written, nothing is deleted", async () => {
    const bad = await makeOrg("ret-fail-a");
    const good = await makeOrg("ret-fail-b");
    const a = await addAnimal(bad);
    const b = await addAnimal(good);
    await fix(a, "2026-08-01T05:00:00Z");
    await fix(b, "2026-08-01T05:00:00Z");
    await q(`create function public.test_fail_summary() returns trigger language plpgsql as $$
             begin if new.organization_id = '${bad.id}' then raise exception 'boom'; end if; return new; end $$`);
    await q("create trigger test_fail_summary before insert on public.fix_daily_summary for each row execute function public.test_fail_summary()");
    try {
      await rollup(null);
    } finally {
      await q("drop trigger test_fail_summary on public.fix_daily_summary");
      await q("drop function public.test_fail_summary()");
    }
    expect(await rawCount(a)).toBe(1); // still there: not deleted without a summary
    expect(await summaries(a)).toEqual([]);
    expect(await rawCount(b)).toBe(0); // the other organization was processed
    expect(await summaries(b)).toHaveLength(1);
  });
});

// ─── who can read the summaries ──────────────────────────────────────────────────────────────────
describe("fix_daily_summary access", () => {
  const LAHORE = "Lahore Main";
  const FAISALABAD = "Faisalabad Main";
  const row = (org: string, animal: number) =>
    q("insert into public.fix_daily_summary (organization_id, animal_id, summary_date, fix_count, first_fix_at, first_lat, first_lon, last_fix_at, last_lat, last_lon) values ($1, $2, '2026-08-01', 1, now(), 1, 1, now(), 1, 1)", [org, animal]);

  beforeAll(async () => {
    await row(fx.bop.id, fx.bop.animals[LAHORE][0]);
    await row(fx.bop.id, fx.bop.animals[FAISALABAD][0]);
    await row(fx.demo.id, fx.demo.animals[LAHORE][0]);
  });

  const seen = (userId: string) => asUser(db, userId, async (qq) => (await qq("select animal_id from public.fix_daily_summary order by animal_id")).rows.map((r) => Number(r.animal_id)));

  it("a user sees only their organization's summaries, and only their scope", async () => {
    expect(await seen(fx.users.bopAdmin)).toEqual([fx.bop.animals[LAHORE][0], fx.bop.animals[FAISALABAD][0]].sort((x, y) => x - y));
    expect(await seen(fx.users.bopAuditor)).toHaveLength(2);
    expect(await seen(fx.users.bopOfficer)).toEqual([fx.bop.animals[LAHORE][0]]);
    expect(await seen(fx.users.demoAdmin)).toEqual([fx.demo.animals[LAHORE][0]]);
  });

  it("a Demo Bank user cannot read a single Bank of Punjab summary", async () => {
    await asUser(db, fx.users.demoAdmin, async (qq) => {
      expect(Number((await qq("select count(*)::int n from public.fix_daily_summary where organization_id = $1", [fx.bop.id])).rows[0].n)).toBe(0);
    });
  });

  it("nobody can write to it through the API, whatever their role", async () => {
    for (const u of ["bopAdmin", "bopRegional", "bopOfficer", "bopAuditor"] as const) {
      await asUser(db, fx.users[u], async (qq) => {
        expect(refused(await probe(qq, "update public.fix_daily_summary set fix_count = 99 returning animal_id")), u).toBe(true);
        expect(refused(await probe(qq, "delete from public.fix_daily_summary returning animal_id")), u).toBe(true);
        const ins = await probe(qq, "insert into public.fix_daily_summary (organization_id, animal_id, summary_date, fix_count, first_fix_at, first_lat, first_lon, last_fix_at, last_lat, last_lon) values ($1, $2, '2026-08-05', 1, now(), 1, 1, now(), 1, 1) returning animal_id", [fx.bop.id, fx.bop.animals[LAHORE][0]]);
        expect(refused(ins), u).toBe(true);
      });
    }
  });

  it("anonymous requests are refused", async () => {
    await asUser(db, null, async (qq) => {
      const p = await probe(qq, "select 1 from public.fix_daily_summary");
      expect(p.ok).toBe(false);
    });
  });
});

// ─── scheduling ──────────────────────────────────────────────────────────────────────────────────
describe("pg_cron jobs", () => {
  let hasCron = true;
  beforeAll(async () => {
    hasCron = (await one("select to_regclass('cron.job') is not null as ok")).ok === true;
  });
  const jobs = async () => (await q("select jobname, schedule, command from cron.job where jobname like 'bovinesense-%' order by jobname")).rows;

  it("schedules the offline check every 15 minutes and the retention job nightly", async () => {
    if (!hasCron) return;
    expect(await jobs()).toEqual([
      { jobname: "bovinesense-check-offline-tags", schedule: "*/15 * * * *", command: "select public.check_offline_tags()" },
      { jobname: "bovinesense-fix-retention", schedule: "0 22 * * *", command: "select public.rollup_and_prune_fixes()" },
    ]);
  });

  it("scheduling again replaces the jobs instead of duplicating them, and repairs a changed schedule", async () => {
    if (!hasCron) return;
    await q("update cron.job set schedule = '* * * * *' where jobname = 'bovinesense-check-offline-tags'");
    await q("select public.schedule_background_jobs()");
    await q("select public.schedule_background_jobs()");
    const rows = await jobs();
    expect(rows).toHaveLength(2);
    expect(rows[0].schedule).toBe("*/15 * * * *");
  });

  it("the scheduled commands run as written", async () => {
    if (!hasCron) return;
    for (const job of await jobs()) {
      const r = await one(job.command as string);
      expect(Object.values(r)[0], job.jobname as string).not.toBeUndefined();
    }
  });
});

// ─── health ──────────────────────────────────────────────────────────────────────────────────────
describe("health helpers", () => {
  it("health_ping answers ok with the server time", async () => {
    const r = (await one("select public.health_ping() as r")).r as { ok: boolean; server_time: string };
    expect(r.ok).toBe(true);
    expect(Number.isNaN(Date.parse(r.server_time))).toBe(false);
  });

  it("background_job_status reports each job's most recent run", async () => {
    const hasCron = (await one("select to_regclass('cron.job') is not null as ok")).ok === true;
    if (!hasCron) return;
    const id = Number((await one("select jobid n from cron.job where jobname = 'bovinesense-check-offline-tags'")).n);
    const initial = (await q("select * from public.background_job_status() order by job_name")).rows;
    expect(initial.map((r) => r.job_name)).toEqual(["bovinesense-check-offline-tags", "bovinesense-fix-retention"]);
    expect(initial.every((r) => r.last_run_at === null)).toBe(true);

    await q("insert into cron.job_run_details (jobid, status, start_time) values ($1, 'failed', now() - interval '2 hours'), ($1, 'succeeded', now() - interval '5 minutes')", [id]);
    const after = (await q("select * from public.background_job_status() where job_name = 'bovinesense-check-offline-tags'")).rows[0];
    expect(after.last_status).toBe("succeeded"); // the newest run, not the oldest
    expect(Date.now() - new Date(after.last_run_at as string).getTime()).toBeLessThan(10 * 60 * 1000);
  });

  it("only the service role may run any of the new functions", async () => {
    const sigs = [
      "public.check_offline_tags(uuid)",
      "public.rollup_and_prune_fixes(uuid, timestamptz, integer)",
      "public.schedule_background_jobs()",
      "public.health_ping()",
      "public.background_job_status()",
      "public.org_offline_threshold_hours(uuid)",
      "public.org_retention_days(uuid)",
      "public.org_timezone(uuid)",
    ];
    for (const sig of sigs) {
      for (const [role, expected] of [["service_role", true], ["authenticated", false], ["anon", false]] as const) {
        const r = await one("select has_function_privilege($1, $2::regprocedure, 'execute') as ok", [role, sig]);
        expect(r.ok, `${role} -> ${sig}`).toBe(expected);
      }
    }
  });
});

// ─── index review ────────────────────────────────────────────────────────────────────────────────
describe("indexes on fixes and alerts", () => {
  const indexNames = async (table: string) =>
    (await q("select indexname from pg_indexes where schemaname = 'public' and tablename = $1 order by 1", [table])).rows.map((r) => r.indexname as string);

  it("has the new organization-leading composites", async () => {
    const fixes = (await one("select indexdef d from pg_indexes where indexname = 'fixes_org_animal_time_idx'")).d as string;
    expect(fixes).toMatch(/\(organization_id, animal_id, fixed_at DESC\)/);
    const alerts = (await one("select indexdef d from pg_indexes where indexname = 'alerts_org_status_created_idx'")).d as string;
    expect(alerts).toMatch(/\(organization_id, status, created_at DESC\)/);
    expect((await one("select indexdef d from pg_indexes where indexname = 'fixes_fixed_at_brin'")).d as string).toMatch(/USING brin \(fixed_at\)/);
  });

  it("dropped the four indexes the composites made redundant, and kept the ones still needed", async () => {
    const fixes = await indexNames("fixes");
    const alerts = await indexNames("alerts");
    for (const gone of ["fixes_organization_id_idx", "fixes_animal_time_idx"]) expect(fixes).not.toContain(gone);
    for (const gone of ["alerts_organization_id_idx", "alerts_status_created_idx"]) expect(alerts).not.toContain(gone);
    expect(fixes).toEqual(expect.arrayContaining(["fixes_pkey", "fixes_tag_time_key", "fixes_org_animal_time_idx", "fixes_fixed_at_brin"]));
    expect(alerts).toEqual(expect.arrayContaining(["alerts_pkey", "alerts_animal_idx", "alerts_org_status_created_idx"]));
  });

  describe("the real queries use them", () => {
    let org: Org;
    let animal: Animal;
    beforeAll(async () => {
      org = await makeOrg("idx-org");
      animal = await addAnimal(org);
      for (let i = 0; i < 40; i++) await fix(animal, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), 31.5, 74.3, 2);
      await q("insert into public.alerts (organization_id, animal_id, tag_id, type, severity, status, title) values ($1, $2, $3, 'breach', 'critical', 'new', 'x')", [org.id, animal.animalId, animal.tagId]);
      await q("analyze public.fixes");
      await q("analyze public.alerts");
    });

    // With sequential scans switched off the planner must pick an index if one can serve the query.
    // Bitmap scans are switched off too: on a table this small the planner would otherwise pick one
    // and sort, which says nothing about whether the index can deliver the order.
    const plan = async (sql: string, params: unknown[]) => {
      await q("set enable_seqscan = off");
      await q("set enable_bitmapscan = off");
      try {
        return (await q(`explain ${sql}`, params)).rows.map((r) => r["QUERY PLAN"] as string).join("\n");
      } finally {
        await q("reset enable_seqscan");
        await q("reset enable_bitmapscan");
      }
    };

    it("latest fix of an animal: index only, no sort", async () => {
      const p = await plan("select * from public.fixes where organization_id = $1 and animal_id = $2 order by fixed_at desc limit 1", [org.id, animal.animalId]);
      expect(p).toContain("fixes_org_animal_time_idx");
      expect(p).not.toMatch(/\bSort\b/);
    });

    it("the 24 h trail the API serves: index only, no sort", async () => {
      const p = await plan(
        "select id, lat, lon, fixed_at, speed_kmh, battery_pct from public.fixes where organization_id = $1 and animal_id = $2 and fixed_at >= $3 order by fixed_at desc limit 1000",
        [org.id, animal.animalId, "2026-09-30T00:00:00Z"],
      );
      expect(p).toContain("fixes_org_animal_time_idx");
      expect(p).not.toMatch(/\bSort\b/);
    });

    it("ingest_fix's previous-fix lookup uses it (the (fixed_at, id) row comparison is applied to a narrow range)", async () => {
      const p = await plan(
        "select lat, lon, fixed_at from public.fixes f where f.organization_id = $1 and f.animal_id = $2 and (f.fixed_at, f.id) < ($3::timestamptz, 999999) order by f.fixed_at desc, f.id desc limit 1",
        [org.id, animal.animalId, "2026-10-01T00:30:00Z"],
      );
      expect(p).toContain("fixes_org_animal_time_idx");
    });

    it("the animal_overview view's latest-fix lookup uses it", async () => {
      const p = await plan("select * from public.animal_overview where id = $1", [animal.animalId]);
      expect(p).toContain("fixes_org_animal_time_idx");
    });

    it("the alert feed and open-alert counts use the alerts composite", async () => {
      const p = await plan("select * from public.alerts where organization_id = $1 and status = 'new' order by created_at desc limit 50", [org.id]);
      expect(p).toContain("alerts_org_status_created_idx");
      expect(p).not.toMatch(/\bSort\b/);
    });

  });
});
