/**
 * Ingestion tests: public.ingest_fix() and the alert rules that now live in PL/pgSQL.
 *
 * Every rule is exercised with fixed coordinates against a rectangular fence:
 *
 *      lon 74.30 ─────────── 74.40
 *   lat 31.60  ┌──────────────┐  <- north edge
 *              │      ·       │     CENTRE (74.35, 31.55), about 5 km from every edge
 *   lat 31.50  └──────────────┘
 *
 * Points are placed north of / below the north edge by a stated number of metres (1 degree of
 * latitude = 111 195 m on the test sphere; PostGIS differs by well under 1%, and every case below
 * keeps a margin of 5% or more from its threshold, so the same tests hold on both backends).
 *
 * Each test uses its own tag and animal, so the order of tests does not matter. Everything runs in
 * one transaction that is rolled back at the end. Backend: PGlite by default, TEST_DATABASE_URL to
 * run against a real Postgres + PostGIS (see backend.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, probe, refused, type Query, type Row, type TestDb } from "./backend";
import { seedFixtures, type Fixtures } from "./fixtures";

let db: TestDb;
let fx: Fixtures;
let q: Query;

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

// ─── fixed coordinates ───────────────────────────────────────────────────────────────────────────
const FENCE = { west: 74.3, south: 31.5, east: 74.4, north: 31.6 };
const LON = 74.35;
const P = {
  CENTRE: 31.55,
  /** Beyond the north edge by ~150 m: outside, below the 200 m hard-breach distance. */
  OUT_150M: 31.60135,
  OUT_190M: 31.60171,
  OUT_210M: 31.60189,
  OUT_250M: 31.60225,
  OUT_600M: 31.6054,
  /** Inside, this far from the north edge. */
  IN_300M: 31.5973,
  IN_700M: 31.5937,
  /** Inside, about 1.1 km from the centre, well clear of every edge. */
  CENTRE_PLUS_1_1KM: 31.56,
};

const at = (minute: number) => new Date(Date.UTC(2026, 9, 9, 10, minute)).toISOString();

// ─── helpers ─────────────────────────────────────────────────────────────────────────────────────
interface Org {
  id: string;
  keyId: string;
  regionId: number;
  branchId: number;
  borrowerId: number;
  loanId: number;
}
interface Animal {
  org: Org;
  serial: string;
  tagId: number;
  animalId: number;
  fenceId: number | null;
}

let seq = 0;
const nextSeq = () => ++seq;

async function one(sql: string, params?: unknown[]): Promise<Row> {
  return (await q(sql, params)).rows[0];
}

async function makeOrg(slug: string, settings: unknown = {}): Promise<Org> {
  const id = (
    await one("insert into public.organizations (name, slug, settings) values ($1, $2, $3::jsonb) returning id", [
      slug, slug, JSON.stringify(settings),
    ])
  ).id as string;
  const regionId = (await one("insert into public.regions (organization_id, name, code) values ($1, 'R', 'R1') returning id", [id])).id as number;
  const branchId = (
    await one("insert into public.branches (organization_id, name, code, region_id) values ($1, 'B', 'B1', $2) returning id", [id, regionId])
  ).id as number;
  const borrowerId = (
    await one("insert into public.borrowers (organization_id, name, cnic, branch_id) values ($1, 'Ali Khan', $2, $3) returning id", [id, `CNIC-${nextSeq()}`, branchId])
  ).id as number;
  const loanId = (
    await one(
      "insert into public.loans (organization_id, loan_number, borrower_id, branch_id, amount_pkr) values ($1, 'LN-1', $2, $3, 100000) returning id",
      [id, borrowerId, branchId],
    )
  ).id as number;
  const keyId = (
    await one(
      "insert into public.device_api_keys (organization_id, key_hash, key_prefix, label) values ($1, $2, 'bs_test', 'test key') returning id",
      [id, (nextSeq().toString(16).padStart(2, "0")).repeat(32)],
    )
  ).id as string;
  return { id, keyId, regionId, branchId, borrowerId, loanId };
}

/** A tag + animal in `org`, assigned to its own rectangular fence (unless `fence: false`). */
async function addAnimal(org: Org, opts: { fence?: boolean; bufferM?: number } = {}): Promise<Animal> {
  const serial = `T-${org.id.slice(0, 4)}-${nextSeq()}`;
  const tagId = (
    await one("insert into public.tags (organization_id, serial_number, is_simulated) values ($1, $2, false) returning id", [org.id, serial])
  ).id as number;
  const animalId = (
    await one(
      `insert into public.animals (organization_id, name, tag_id, borrower_id, loan_id, branch_id, district, status)
       values ($1, 'Bessie', $2, $3, $4, $5, 'Lahore', 'inside') returning id`,
      [org.id, tagId, org.borrowerId, org.loanId, org.branchId],
    )
  ).id as number;
  let fenceId: number | null = null;
  if (opts.fence !== false) {
    fenceId = (
      await one(
        `insert into public.geofences (organization_id, name, type, geom, warning_buffer_m)
         values ($1, $2, 'polygon', extensions.st_makeenvelope($3, $4, $5, $6, 4326), $7) returning id`,
        [org.id, `fence ${serial}`, FENCE.west, FENCE.south, FENCE.east, FENCE.north, opts.bufferM ?? 500],
      )
    ).id as number;
    await q("insert into public.animal_geofence (organization_id, animal_id, geofence_id, is_active) values ($1, $2, $3, true)", [
      org.id, animalId, fenceId,
    ]);
  }
  return { org, serial, tagId, animalId, fenceId };
}

interface Send {
  lat?: number;
  lon?: number;
  minute?: number;
  speed?: number | null;
  battery?: number | null;
  signal?: number | null;
  /** Override the organization the call is made for (to test tenant resolution). */
  org?: Org;
  serial?: string;
}
interface Result {
  fix_id: number;
  animal_id: number;
  status: string;
  previous_status: string;
  latest: boolean;
  duplicate: boolean;
  speed_kmh: number | null;
  alerts: Array<{ id: number; type: string; severity: string }>;
  alerts_raised: number;
}

/** Calls ingest_fix the way the route does. Defaults: a slow (4 km/h), healthy-battery fix. */
async function send(a: Animal, s: Send = {}): Promise<Result> {
  const org = s.org ?? a.org;
  const r = await one(
    `select public.ingest_fix($1::uuid, $2::uuid, $3::text, $4::float8, $5::float8, $6::timestamptz,
                              $7::float8, $8::int, $9::int) as r`,
    [
      org.id, org.keyId, s.serial ?? a.serial, s.lat ?? P.CENTRE, s.lon ?? LON, at(s.minute ?? 0),
      s.speed === undefined ? 4 : s.speed,
      s.battery === undefined ? 80 : s.battery,
      s.signal === undefined ? 3 : s.signal,
    ],
  );
  return (typeof r.r === "string" ? JSON.parse(r.r) : r.r) as Result;
}

async function alertsOf(a: Animal): Promise<Row[]> {
  return (await q("select id, type, severity, status, title, detail, distance_km from public.alerts where animal_id = $1 order by id", [a.animalId])).rows;
}
const types = async (a: Animal) => (await alertsOf(a)).map((r) => r.type as string);
const statusOf = async (a: Animal) => (await one("select status from public.animals where id = $1", [a.animalId])).status as string;
const fixCount = async (a: Animal) => Number((await one("select count(*)::int n from public.fixes where tag_id = $1", [a.tagId])).n);

/** Run a statement expecting it to fail; returns the error (rolled back to a savepoint). */
async function failure(sql: string, params?: unknown[]): Promise<{ code?: string; message: string } | null> {
  await q("savepoint expect_fail");
  try {
    await q(sql, params);
    return null;
  } catch (err) {
    return { code: (err as { code?: string }).code, message: (err as Error).message };
  } finally {
    await q("rollback to savepoint expect_fail");
    await q("release savepoint expect_fail");
  }
}

let org: Org;
let other: Org;
beforeAll(async () => {
  org = await makeOrg("ingest-a");
  other = await makeOrg("ingest-b");
});

// ─── breach ──────────────────────────────────────────────────────────────────────────────────────
describe("rule: breach", () => {
  it("a single fix 250 m outside the fence is a breach (>= 200 m)", async () => {
    const a = await addAnimal(org);
    const r = await send(a, { lat: P.OUT_250M });
    expect(r.alerts_raised).toBe(1);
    expect(r.status).toBe("breach");
    expect(await statusOf(a)).toBe("breach");
    const [alert] = await alertsOf(a);
    expect(alert).toMatchObject({ type: "breach", severity: "critical", status: "new", title: "Left district boundary" });
    expect(Number(alert.distance_km)).toBeGreaterThan(0.24);
    expect(Number(alert.distance_km)).toBeLessThan(0.26);
    expect(alert.detail as string).toContain("km outside boundary");
    expect(alert.detail as string).toContain("Bessie (Ali Khan)");
    expect(alert.detail as string).toContain("LN-1");
  });

  it("the hard-breach distance is 200 m: 190 m outside is not a breach, 210 m is", async () => {
    const near = await addAnimal(org);
    await send(near, { lat: P.OUT_190M });
    expect(await types(near)).toEqual(["near_boundary"]);
    expect(await statusOf(near)).toBe("near");

    const hard = await addAnimal(org);
    await send(hard, { lat: P.OUT_210M });
    expect(await types(hard)).toEqual(["breach"]);
    expect(await statusOf(hard)).toBe("breach");
  });

  it("two consecutive fixes outside confirm a breach even when each is under 200 m", async () => {
    const a = await addAnimal(org);
    const first = await send(a, { lat: P.OUT_150M, minute: 0 });
    expect(first.status).toBe("near");
    const second = await send(a, { lat: P.OUT_150M, minute: 1 });
    expect(second.status).toBe("breach");
    expect(await types(a)).toEqual(["near_boundary", "breach"]);
  });

  it("outside, inside, outside is NOT a breach: the fixes are not consecutive", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.OUT_150M, minute: 0 });
    await send(a, { lat: P.CENTRE, minute: 10 });
    const third = await send(a, { lat: P.OUT_150M, minute: 20 });
    expect(third.status).toBe("near");
    expect(await types(a)).toEqual(["near_boundary", "near_boundary"]);
    expect(await statusOf(a)).toBe("near");
  });

  it("is raised once: further fixes outside do not raise it again", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.OUT_250M, minute: 0 });
    const again = await send(a, { lat: P.OUT_600M, minute: 1 });
    expect(again.alerts_raised).toBe(0);
    expect(again.status).toBe("breach");
    expect(await types(a)).toEqual(["breach"]);
  });

  it("writes the alert's audit event (system-created: no user)", async () => {
    const a = await addAnimal(org);
    const r = await send(a, { lat: P.OUT_250M });
    const ev = await one("select from_status, to_status, user_id from public.alert_events where alert_id = $1", [r.alerts[0].id]);
    expect(ev).toMatchObject({ from_status: null, to_status: "new", user_id: null });
  });
});

// ─── near boundary ───────────────────────────────────────────────────────────────────────────────
describe("rule: near boundary", () => {
  it("inside but 300 m from the edge (buffer 500 m) raises 'Approaching district boundary'", async () => {
    const a = await addAnimal(org);
    const r = await send(a, { lat: P.IN_300M });
    expect(r.status).toBe("near");
    const [alert] = await alertsOf(a);
    expect(alert).toMatchObject({ type: "near_boundary", severity: "warning", title: "Approaching district boundary" });
    expect(alert.detail as string).toContain("m from boundary inside fence");
  });

  it("inside and 700 m from the edge is clear of the buffer: no alert, status inside", async () => {
    const a = await addAnimal(org);
    const r = await send(a, { lat: P.IN_700M });
    expect(r.alerts_raised).toBe(0);
    expect(r.status).toBe("inside");
  });

  it("the warning buffer is per fence: 700 m is inside a 1000 m buffer, outside a 200 m one", async () => {
    const wide = await addAnimal(org, { bufferM: 1000 });
    await send(wide, { lat: P.IN_700M });
    expect(await types(wide)).toEqual(["near_boundary"]);

    const narrow = await addAnimal(org, { bufferM: 200 });
    await send(narrow, { lat: P.IN_300M });
    expect(await types(narrow)).toEqual([]);
    expect(await statusOf(narrow)).toBe("inside");
  });

  it("a single outside fix under 200 m on the transition raises 'Near district boundary'", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.OUT_150M });
    const [alert] = await alertsOf(a);
    expect(alert).toMatchObject({ type: "near_boundary", severity: "warning", title: "Near district boundary" });
    expect(alert.detail as string).toContain("m outside boundary");
  });

  it("is raised once while the animal stays near", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.IN_300M, minute: 0 });
    const again = await send(a, { lat: P.IN_300M, minute: 1 });
    expect(again.alerts_raised).toBe(0);
    expect(await types(a)).toEqual(["near_boundary"]);
  });

  it("clears back to inside when the animal moves away from the edge", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.IN_300M, minute: 0 });
    const r = await send(a, { lat: P.CENTRE, minute: 30 });
    expect(r.status).toBe("inside");
    expect(await statusOf(a)).toBe("inside");
  });
});

// ─── fast movement ───────────────────────────────────────────────────────────────────────────────
describe("rule: fast movement", () => {
  it("a reported speed of 16 km/h raises a critical fast-movement alert", async () => {
    const a = await addAnimal(org);
    const r = await send(a, { speed: 16 });
    expect(r.status).toBe("fast");
    const [alert] = await alertsOf(a);
    expect(alert).toMatchObject({ type: "fast_movement", severity: "critical", title: "Fast movement detected" });
    expect(alert.detail as string).toContain("16 km/h");
  });

  it("the threshold is strictly greater than 15 km/h: 15 is quiet, 15.1 is not", async () => {
    const at15 = await addAnimal(org);
    expect((await send(at15, { speed: 15 })).alerts_raised).toBe(0);
    expect(await statusOf(at15)).toBe("inside");

    const above = await addAnimal(org);
    expect((await send(above, { speed: 15.1 })).alerts_raised).toBe(1);
  });

  it("without a reported speed it is computed from the previous fix (1.1 km in 1 minute is ~67 km/h)", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.CENTRE, minute: 0, speed: null });
    const r = await send(a, { lat: P.CENTRE_PLUS_1_1KM, minute: 1, speed: null });
    expect(r.speed_kmh).toBeGreaterThan(60);
    expect(r.speed_kmh).toBeLessThan(72);
    expect(await types(a)).toEqual(["fast_movement"]);
  });

  it("the same 1.1 km over 10 minutes is ~6.7 km/h: no alert", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.CENTRE, minute: 0, speed: null });
    const r = await send(a, { lat: P.CENTRE_PLUS_1_1KM, minute: 10, speed: null });
    expect(r.speed_kmh).toBeGreaterThan(5);
    expect(r.speed_kmh).toBeLessThan(8);
    expect(r.alerts_raised).toBe(0);
  });

  it("is raised once while it is open, and again after a person resolves it", async () => {
    const a = await addAnimal(org);
    await send(a, { speed: 30, minute: 0 });
    expect((await send(a, { speed: 30, minute: 1 })).alerts_raised).toBe(0);
    expect(await types(a)).toEqual(["fast_movement"]);

    await q("update public.alerts set status = 'resolved' where animal_id = $1", [a.animalId]);
    expect((await send(a, { speed: 30, minute: 2 })).alerts_raised).toBe(1);
    expect(await types(a)).toEqual(["fast_movement", "fast_movement"]);
  });
});

// ─── low battery ─────────────────────────────────────────────────────────────────────────────────
describe("rule: low battery", () => {
  it("19% raises an info alert; the threshold is strictly below 20%", async () => {
    const low = await addAnimal(org);
    await send(low, { battery: 19 });
    const [alert] = await alertsOf(low);
    expect(alert).toMatchObject({ type: "low_battery", severity: "info", title: "Low battery" });
    expect(alert.detail as string).toContain("Battery at 19%");

    const edge = await addAnimal(org);
    expect((await send(edge, { battery: 20 })).alerts_raised).toBe(0);
  });

  it("a missing battery reading raises nothing", async () => {
    const a = await addAnimal(org);
    expect((await send(a, { battery: null })).alerts_raised).toBe(0);
  });

  it("does not change the animal's status, and is raised once while open", async () => {
    const a = await addAnimal(org);
    expect((await send(a, { battery: 5, minute: 0 })).status).toBe("inside");
    expect((await send(a, { battery: 4, minute: 1 })).alerts_raised).toBe(0);
    expect(await types(a)).toEqual(["low_battery"]);
  });
});

// ─── returned ────────────────────────────────────────────────────────────────────────────────────
describe("rule: returned", () => {
  it("back inside after a breach: an info 'Returned' alert, status inside, the breach stays open", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.OUT_250M, minute: 0 });
    const r = await send(a, { lat: P.CENTRE, minute: 30 });
    expect(r.status).toBe("inside");
    expect(r.previous_status).toBe("breach");
    expect(await types(a)).toEqual(["breach", "returned"]);

    const [breach, returned] = await alertsOf(a);
    expect(returned).toMatchObject({ severity: "info", title: "Returned to boundary" });
    expect(breach.status).toBe("new"); // never auto-resolved: a human must close it
  });

  it("still outside after a breach: no 'Returned' alert", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.OUT_250M, minute: 0 });
    await send(a, { lat: P.OUT_150M, minute: 1 });
    expect(await types(a)).toEqual(["breach"]);
    expect(await statusOf(a)).toBe("breach");
  });

  it("is not raised for an animal that was never in breach", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.OUT_150M, minute: 0 });
    await send(a, { lat: P.CENTRE, minute: 30 });
    expect(await types(a)).toEqual(["near_boundary"]);
  });
});

// ─── thresholds are per organization ─────────────────────────────────────────────────────────────
describe("per-organization thresholds (defaults: 200 m, 2 fixes, 15 km/h, 20%)", () => {
  it("the defaults apply when an organization sets nothing", async () => {
    const r = await one("select * from public.org_alert_rules($1)", [org.id]);
    // numeric columns come back as strings
    expect([Number(r.hard_breach_metres), Number(r.breach_consecutive_fixes), Number(r.speed_threshold_kmh), Number(r.low_battery_pct)]).toEqual([200, 2, 15, 20]);
  });

  it("hard_breach_metres: 500 makes 250 m outside a near-boundary, and 600 m a breach", async () => {
    const strict = await makeOrg("ingest-hard", { alert_rules: { hard_breach_metres: 500 } });
    const a = await addAnimal(strict);
    await send(a, { lat: P.OUT_250M });
    expect(await types(a)).toEqual(["near_boundary"]);
    const b = await addAnimal(strict);
    await send(b, { lat: P.OUT_600M });
    expect(await types(b)).toEqual(["breach"]);
  });

  it("breach_consecutive_fixes: 3 needs three fixes outside", async () => {
    const slow = await makeOrg("ingest-consec", { alert_rules: { breach_consecutive_fixes: 3 } });
    const a = await addAnimal(slow);
    await send(a, { lat: P.OUT_150M, minute: 0 });
    expect((await send(a, { lat: P.OUT_150M, minute: 1 })).status).toBe("near");
    expect((await send(a, { lat: P.OUT_150M, minute: 2 })).status).toBe("breach");
    expect(await types(a)).toEqual(["near_boundary", "breach"]);
  });

  it("breach_consecutive_fixes: 3 counts only the unbroken run: outside, inside, outside, outside is not enough", async () => {
    const slow = await makeOrg("ingest-run", { alert_rules: { breach_consecutive_fixes: 3 } });
    const a = await addAnimal(slow);
    await send(a, { lat: P.OUT_150M, minute: 0 });
    await send(a, { lat: P.CENTRE, minute: 10 });
    await send(a, { lat: P.OUT_150M, minute: 20 });
    const r = await send(a, { lat: P.OUT_150M, minute: 21 });
    expect(r.status).toBe("near"); // run of two, broken by the inside fix before it
    expect(await types(a)).toEqual(["near_boundary", "near_boundary"]);
    expect((await send(a, { lat: P.OUT_150M, minute: 22 })).status).toBe("breach"); // now a run of three
  });

  it("speed_threshold_kmh: 30 ignores 20 km/h and flags 31 km/h", async () => {
    const quick = await makeOrg("ingest-speed", { alert_rules: { speed_threshold_kmh: 30 } });
    const a = await addAnimal(quick);
    expect((await send(a, { speed: 20 })).alerts_raised).toBe(0);
    const b = await addAnimal(quick);
    expect((await send(b, { speed: 31 })).alerts_raised).toBe(1);
  });

  it("low_battery_pct: 30 flags 25%", async () => {
    const picky = await makeOrg("ingest-battery", { alert_rules: { low_battery_pct: 30 } });
    const a = await addAnimal(picky);
    expect((await send(a, { battery: 25 })).alerts_raised).toBe(1);
  });

  it("one organization's settings never affect another's (same fix, different outcome)", async () => {
    const lenient = await makeOrg("ingest-lenient", { alert_rules: { hard_breach_metres: 1000, low_battery_pct: 5 } });
    const a = await addAnimal(lenient);
    const b = await addAnimal(org);
    await send(a, { lat: P.OUT_250M, battery: 10 });
    await send(b, { lat: P.OUT_250M, battery: 10 });
    expect(await types(a)).toEqual(["near_boundary"]);
    expect((await types(b)).sort()).toEqual(["breach", "low_battery"]);
  });

  it("invalid settings (a string, a negative number, a zero count) fall back to the defaults", async () => {
    const bad = await makeOrg("ingest-bad", {
      alert_rules: { hard_breach_metres: "lots", speed_threshold_kmh: -5, breach_consecutive_fixes: 0, low_battery_pct: null },
    });
    const r = await one("select * from public.org_alert_rules($1)", [bad.id]);
    expect([Number(r.hard_breach_metres), Number(r.breach_consecutive_fixes), Number(r.speed_threshold_kmh), Number(r.low_battery_pct)]).toEqual([200, 2, 15, 20]);
    const a = await addAnimal(bad);
    await send(a, { lat: P.OUT_250M });
    expect(await types(a)).toEqual(["breach"]); // the default 200 m applied
  });

  it("settings that are not an object at all are tolerated", async () => {
    const odd = await makeOrg("ingest-odd", { alert_rules: "nope" });
    const r = await one("select * from public.org_alert_rules($1)", [odd.id]);
    expect(Number(r.hard_breach_metres)).toBe(200);
  });
});

// ─── tenancy: the tag is resolved inside the key's organization only ─────────────────────────────
describe("tenant resolution", () => {
  it("another organization's tag serial is indistinguishable from an unknown one", async () => {
    const theirs = await addAnimal(other);
    const err = await failure(
      "select public.ingest_fix($1::uuid, $2::uuid, $3::text, 31.55::float8, 74.35::float8, $4::timestamptz, 4::float8, 80, 3)",
      [org.id, org.keyId, theirs.serial, at(0)],
    );
    expect(err?.message).toContain("tag_not_found");
    expect(err?.code).toBe("P0002");
    expect(await fixCount(theirs)).toBe(0);
  });

  it("an unknown serial is tag_not_found", async () => {
    const err = await failure(
      "select public.ingest_fix($1::uuid, $2::uuid, 'NO-SUCH-TAG', 31.55::float8, 74.35::float8, $3::timestamptz)",
      [org.id, org.keyId, at(0)],
    );
    expect(err?.message).toContain("tag_not_found");
  });

  it("a tag with no animal is animal_not_found, and stores nothing", async () => {
    const serial = `SPARE-${nextSeq()}`;
    const tagId = (await one("insert into public.tags (organization_id, serial_number) values ($1, $2) returning id", [org.id, serial])).id;
    const err = await failure(
      "select public.ingest_fix($1::uuid, $2::uuid, $3::text, 31.55::float8, 74.35::float8, $4::timestamptz)",
      [org.id, org.keyId, serial, at(0)],
    );
    expect(err?.message).toContain("animal_not_found");
    expect(Number((await one("select count(*)::int n from public.fixes where tag_id = $1", [tagId])).n)).toBe(0);
  });

  it("fixes and alerts are written under the key's organization, and the other one sees none", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.OUT_250M, battery: 5 });
    const mine = await one(
      "select (select count(*) from public.fixes where tag_id = $1 and organization_id = $2)::int f, (select count(*) from public.alerts where animal_id = $3 and organization_id = $2)::int a, (select count(*) from public.alert_events e join public.alerts al on al.id = e.alert_id where al.animal_id = $3 and e.organization_id = $2)::int e",
      [a.tagId, org.id, a.animalId],
    );
    expect(mine).toMatchObject({ f: 1, a: 2, e: 2 });
    const theirs = await one("select count(*)::int n from public.alerts where animal_id = $1 and organization_id = $2", [a.animalId, other.id]);
    expect(theirs.n).toBe(0);
  });

  it("the same alert rules run in each organization independently (identical fix, identical outcome)", async () => {
    const a = await addAnimal(org);
    const b = await addAnimal(other);
    expect((await send(a, { lat: P.OUT_250M })).status).toBe("breach");
    expect((await send(b, { lat: P.OUT_250M })).status).toBe("breach");
    expect(await types(a)).toEqual(["breach"]);
    expect(await types(b)).toEqual(["breach"]);
  });
});

// ─── robustness ──────────────────────────────────────────────────────────────────────────────────
describe("idempotency, ordering and atomicity", () => {
  it("a retransmitted fix (same tag and timestamp) is accepted once and changes nothing", async () => {
    const a = await addAnimal(org);
    const first = await send(a, { lat: P.OUT_250M, minute: 5 });
    const again = await send(a, { lat: P.OUT_250M, minute: 5 });
    expect(again.duplicate).toBe(true);
    expect(again.fix_id).toBe(first.fix_id);
    expect(again.alerts_raised).toBe(0);
    expect(await fixCount(a)).toBe(1);
    expect(await types(a)).toEqual(["breach"]);
  });

  it("a late fix is kept as history but cannot change the animal's state or raise alerts", async () => {
    const a = await addAnimal(org);
    await send(a, { lat: P.CENTRE, minute: 10 });
    const late = await send(a, { lat: P.OUT_250M, minute: 5, battery: 3 });
    expect(late.latest).toBe(false);
    expect(late.alerts_raised).toBe(0);
    expect(await statusOf(a)).toBe("inside");
    expect(await fixCount(a)).toBe(2);
    expect(await types(a)).toEqual([]);
  });

  it("an animal without a fence still records last seen and gets the speed and battery rules", async () => {
    const a = await addAnimal(org, { fence: false });
    const r = await send(a, { lat: 10, lon: 10, minute: 3, speed: 40, battery: 7 });
    expect(r.alerts.map((x) => x.type).sort()).toEqual(["fast_movement", "low_battery"]);
    expect(r.status).toBe("fast");
    const tag = await one("select last_seen_at from public.tags where id = $1", [a.tagId]);
    expect(new Date(tag.last_seen_at as string).toISOString()).toBe(at(3));
  });

  it("records the tag's last seen time, and never moves it backwards", async () => {
    const a = await addAnimal(org);
    await send(a, { minute: 20 });
    await send(a, { minute: 10 });
    const tag = await one("select last_seen_at from public.tags where id = $1", [a.tagId]);
    expect(new Date(tag.last_seen_at as string).toISOString()).toBe(at(20));
  });

  it("is atomic: if raising an alert fails, the fix and the status change are rolled back too", async () => {
    const a = await addAnimal(org);
    await q(`create function public.test_fail_alert() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await q("create trigger test_fail_alert before insert on public.alerts for each row execute function public.test_fail_alert()");
    try {
      await q(`do $$ begin
        perform public.ingest_fix('${org.id}'::uuid, '${org.keyId}'::uuid, '${a.serial}', ${P.OUT_250M}::float8, ${LON}::float8, '${at(0)}'::timestamptz, 4::float8, 80, 3);
      exception when others then null; end $$`);
    } finally {
      await q("drop trigger test_fail_alert on public.alerts");
      await q("drop function public.test_fail_alert()");
    }
    expect(await fixCount(a)).toBe(0);
    expect(await statusOf(a)).toBe("inside");
    expect((await one("select last_seen_at from public.tags where id = $1", [a.tagId])).last_seen_at).toBeNull();
    expect(await alertsOf(a)).toEqual([]);
  });
});

// ─── device keys ─────────────────────────────────────────────────────────────────────────────────
describe("device_api_keys", () => {
  const HASH = "a".repeat(64);

  it("accepts only a SHA-256 hex digest as key_hash, and a hash can be registered once", async () => {
    const bad = await failure(
      "insert into public.device_api_keys (organization_id, key_hash, key_prefix, label) values ($1, 'not-a-hash', 'bs_x', 'x')",
      [org.id],
    );
    expect(bad?.code).toBe("23514");

    await q("insert into public.device_api_keys (organization_id, key_hash, key_prefix, label) values ($1, $2, 'bs_x', 'one')", [org.id, HASH]);
    const dup = await failure(
      "insert into public.device_api_keys (organization_id, key_hash, key_prefix, label) values ($1, $2, 'bs_x', 'two')",
      [other.id, HASH],
    );
    expect(dup?.code).toBe("23505");
  });

  it("ingest records when the key was last used", async () => {
    const o = await makeOrg("ingest-lastused");
    const before = await one("select last_used_at from public.device_api_keys where id = $1", [o.keyId]);
    expect(before.last_used_at).toBeNull();
    const a = await addAnimal(o);
    await send(a);
    const after = await one("select last_used_at from public.device_api_keys where id = $1", [o.keyId]);
    expect(after.last_used_at).not.toBeNull();
  });

  const callWith = (orgId: string, keyId: string, serial: string) =>
    failure(
      "select public.ingest_fix($1::uuid, $2::uuid, $3::text, 31.55::float8, 74.35::float8, $4::timestamptz)",
      [orgId, keyId, serial, at(0)],
    );

  it("a key that belongs to another organization is refused (invalid_key) and never touched", async () => {
    const o = await makeOrg("ingest-foreignkey");
    const victim = await makeOrg("ingest-victim"); // its key has never been used
    const a = await addAnimal(o);
    const err = await callWith(o.id, victim.keyId, a.serial);
    expect(err?.message).toContain("invalid_key");
    expect(err?.code).toBe("28000");
    expect((await one("select last_used_at from public.device_api_keys where id = $1", [victim.keyId])).last_used_at).toBeNull();
    expect(await fixCount(a)).toBe(0);
  });

  it("a revoked key is refused, and so is an unknown key id", async () => {
    const o = await makeOrg("ingest-revoked");
    const a = await addAnimal(o);
    await q("update public.device_api_keys set revoked_at = now() where id = $1", [o.keyId]);
    expect((await callWith(o.id, o.keyId, a.serial))?.message).toContain("invalid_key");
    expect((await callWith(o.id, "00000000-0000-0000-0000-000000000000", a.serial))?.message).toContain("invalid_key");
    expect(await fixCount(a)).toBe(0);
  });

  it("a suspended organization is refused", async () => {
    const o = await makeOrg("ingest-suspended");
    const a = await addAnimal(o);
    await q("update public.organizations set status = 'suspended' where id = $1", [o.id]);
    expect((await callWith(o.id, o.keyId, a.serial))?.message).toContain("invalid_key");
    await q("update public.organizations set status = 'active' where id = $1", [o.id]);
    expect(await callWith(o.id, o.keyId, a.serial)).toBeNull();
  });

  it("only ingest's system functions are executable by the service role, never by app users", async () => {
    const sigs = [
      "public.ingest_fix(uuid, uuid, text, double precision, double precision, timestamptz, double precision, integer, integer)",
      "public.org_alert_rules(uuid)",
      "public._raise_alert(uuid, integer, integer, public.alert_type, public.alert_severity, text, text, real)",
    ];
    for (const sig of sigs) {
      for (const [role, expected] of [["service_role", true], ["authenticated", false], ["anon", false]] as const) {
        const r = await one("select has_function_privilege($1, $2::regprocedure, 'execute') as ok", [role, sig]);
        expect(r.ok, `${role} -> ${sig}`).toBe(expected);
      }
    }
  });

  it("the service role can run ingest_fix end to end (it has every table privilege it needs)", async () => {
    const o = await makeOrg("ingest-service");
    const a = await addAnimal(o);
    await q("set role service_role");
    try {
      const r = await one(
        "select public.ingest_fix($1::uuid, $2::uuid, $3::text, $4::float8, $5::float8, $6::timestamptz, 4::float8, 80, 3) as r",
        [o.id, o.keyId, a.serial, P.OUT_250M, LON, at(0)],
      );
      expect((r.r as Result).alerts_raised).toBe(1);
    } finally {
      await q("reset role");
    }
  });
});

describe("device_api_keys: Row Level Security", () => {
  const insertKey = (qq: Query, orgId: string, userId: string, hash: string) =>
    probe(
      qq,
      "insert into public.device_api_keys (organization_id, key_hash, key_prefix, label, created_by) values ($1, $2, 'bs_t', 'k', $3) returning id",
      [orgId, hash, userId],
    );

  it("an organization admin lists their own organization's keys and nobody else's", async () => {
    await asUser(db, fx.users.demoAdmin, async (qq) => {
      const labels = (await qq("select label from public.device_api_keys")).rows.map((r) => r.label);
      expect(labels).toEqual(["Demo Bank key"]);
    });
    await asUser(db, fx.users.bopAdmin, async (qq) => {
      const labels = (await qq("select label from public.device_api_keys")).rows.map((r) => r.label);
      expect(labels).toEqual(["Bank of Punjab key"]);
    });
  });

  it("only org admins can see keys: officers, regional managers and auditors see none", async () => {
    for (const u of ["bopOfficer", "bopRegional", "bopAuditor"] as const) {
      await asUser(db, fx.users[u], async (qq) => {
        expect((await qq("select id from public.device_api_keys")).rows, u).toEqual([]);
      });
    }
  });

  it("the stored hash can never be read through the API, even by an org admin", async () => {
    await asUser(db, fx.users.bopAdmin, async (qq) => {
      const p = await probe(qq, "select key_hash from public.device_api_keys");
      expect(p.ok).toBe(false);
      expect(p.code).toBe("42501");
      const star = await probe(qq, "select * from public.device_api_keys");
      expect(star.ok).toBe(false);
    });
  });

  it("an org admin can create a key for their organization, as themselves, but not for another", async () => {
    await asUser(db, fx.users.bopAdmin, async (qq) => {
      expect(refused(await insertKey(qq, fx.bop.id, fx.users.bopAdmin, "1".repeat(64)))).toBe(false);
      expect(refused(await insertKey(qq, fx.demo.id, fx.users.bopAdmin, "2".repeat(64)))).toBe(true);
      expect(refused(await insertKey(qq, fx.bop.id, fx.users.demoAdmin, "3".repeat(64)))).toBe(true); // forged created_by
    });
  });

  it("officers, regional managers and auditors cannot create keys", async () => {
    for (const u of ["bopOfficer", "bopRegional", "bopAuditor"] as const) {
      await asUser(db, fx.users[u], async (qq) => {
        expect(refused(await insertKey(qq, fx.bop.id, fx.users[u], "4".repeat(64))), u).toBe(true);
      });
    }
  });

  it("an org admin can revoke a key, but not un-revoke it, rename it or revoke another organization's", async () => {
    const mine = fx.bop.deviceKeyId;
    const theirs = fx.demo.deviceKeyId;
    await asUser(db, fx.users.bopAdmin, async (qq) => {
      expect(refused(await probe(qq, "update public.device_api_keys set revoked_at = now() where id = $1 returning id", [mine]))).toBe(false);
      expect(refused(await probe(qq, "update public.device_api_keys set label = 'x' where id = $1 returning id", [mine]))).toBe(true);
      expect(refused(await probe(qq, "update public.device_api_keys set revoked_at = now() where id = $1 returning id", [theirs]))).toBe(true);
    });
    await q("update public.device_api_keys set revoked_at = now() where id = $1", [mine]);
    await asUser(db, fx.users.bopAdmin, async (qq) => {
      expect(refused(await probe(qq, "update public.device_api_keys set revoked_at = null where id = $1 returning id", [mine]))).toBe(true);
    });
  });

  it("nobody can delete a key through the API (revoke it instead)", async () => {
    await asUser(db, fx.users.bopAdmin, async (qq) => {
      const p = await probe(qq, "delete from public.device_api_keys returning id");
      expect(refused(p)).toBe(true);
    });
  });

  it("anonymous requests cannot touch keys", async () => {
    await asUser(db, null, async (qq) => {
      const p = await probe(qq, "select id from public.device_api_keys");
      expect(p.ok).toBe(false);
    });
  });
});
