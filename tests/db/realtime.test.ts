/**
 * Realtime and Row Level Security.
 *
 * Supabase Realtime sends a postgres_changes event to a subscriber only if THAT subscriber's role
 * (`authenticated`, with their JWT) can SELECT the changed row. So the question "does RLS apply to
 * the live subscriptions?" is the question "which users can see the rows that ingest_fix() just
 * wrote?". These tests write real rows through ingest_fix() for both organizations (and for
 * several branches / regions of one), then check, as each kind of user, exactly which of those
 * rows they can see. They also pin down which tables are published, because publishing a table
 * is what makes its changes available to subscribe to.
 *
 * What this cannot prove is the Realtime server itself. That is checked by hand against a real
 * project (README, "Verifying realtime isolation").
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, probe, type Query, type TestDb } from "./backend";
import { seedFixtures, type Fixtures, type UserKey } from "./fixtures";

let db: TestDb;
let fx: Fixtures;

interface Written { fix: number; alert: number; animal: number }
const written: Record<string, Written> = {};

const LAHORE = "Lahore Main";
const FAISALABAD = "Faisalabad Main";
const MULTAN = "Multan Main";

async function ingestLowBattery(orgId: string, keyId: string, animalId: number, minute: number): Promise<Written> {
  const serial = (
    await db.query("select t.serial_number s from public.tags t join public.animals a on a.tag_id = t.id where a.id = $1", [animalId])
  ).rows[0].s as string;
  const r = (
    await db.query(
      `select public.ingest_fix($1::uuid, $2::uuid, $3::text, 31.5::float8, 74.3::float8, $4::timestamptz,
                                4::float8, 5, 3) as r`,
      [orgId, keyId, serial, new Date(Date.UTC(2026, 9, 10, 9, minute)).toISOString()],
    )
  ).rows[0].r as { fix_id: number; alerts: Array<{ id: number }> };
  expect(r.alerts.length, "the low battery alert is what the test watches").toBeGreaterThan(0);
  return { fix: r.fix_id, alert: r.alerts[0].id, animal: animalId };
}

beforeAll(async () => {
  db = await createTestDb();
  await db.query("begin");
  fx = await seedFixtures(db.query);

  written.bopLahore = await ingestLowBattery(fx.bop.id, fx.bop.deviceKeyId, fx.bop.animals[LAHORE][0], 1);
  written.bopFaisalabad = await ingestLowBattery(fx.bop.id, fx.bop.deviceKeyId, fx.bop.animals[FAISALABAD][0], 2);
  written.bopMultan = await ingestLowBattery(fx.bop.id, fx.bop.deviceKeyId, fx.bop.animals[MULTAN][0], 3);
  written.demoLahore = await ingestLowBattery(fx.demo.id, fx.demo.deviceKeyId, fx.demo.animals[LAHORE][0], 4);
});

afterAll(async () => {
  await db.query("rollback");
  await db.close();
});

const idsIn = async (q: Query, table: string, ids: number[]) =>
  (await q(`select id from public.${table} where id = any($1::int[])`, [ids])).rows
    .map((r) => Number(r.id))
    .sort((a, b) => a - b);

/** Which of the rows written above can this user see? (the rows Realtime would deliver to them) */
async function visibleTo(userId: string | null) {
  return asUser(db, userId, async (q) => {
    const out: Record<string, { fix: boolean; alert: boolean; animal: boolean }> = {};
    for (const [name, w] of Object.entries(written)) {
      out[name] = {
        fix: (await idsIn(q, "fixes", [w.fix])).length === 1,
        alert: (await idsIn(q, "alerts", [w.alert])).length === 1,
        animal: (await idsIn(q, "animals", [w.animal])).length === 1,
      };
    }
    return out;
  });
}
const all = { fix: true, alert: true, animal: true };
const none = { fix: false, alert: false, animal: false };

describe("what is published to Realtime", () => {
  it("publishes exactly fixes, alerts and animals", async () => {
    const rows = (await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1")).rows;
    expect(rows.map((r) => r.tablename)).toEqual(["alerts", "animals", "fixes"]);
  });

  it("never publishes tables holding secrets or personal data", async () => {
    const published = (await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime'")).rows.map((r) => r.tablename);
    for (const t of ["device_api_keys", "memberships", "profiles", "organizations", "platform_admins", "platform_audit_log", "borrowers", "loans"]) {
      expect(published, t).not.toContain(t);
    }
  });

  it("every published table carries organization_id (so subscriptions can filter by it)", async () => {
    for (const t of ["fixes", "alerts", "animals"]) {
      const r = await db.query(
        "select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'organization_id'",
        [t],
      );
      expect(r.rows.length, t).toBe(1);
    }
  });

  it("the writes the dashboard reacts to really happened (fix row, alert row)", async () => {
    for (const [name, w] of Object.entries(written)) {
      expect(await idsIn(db.query, "fixes", [w.fix]), name).toEqual([w.fix]);
      expect(await idsIn(db.query, "alerts", [w.alert]), name).toEqual([w.alert]);
    }
  });
});

describe("Realtime delivers a row only to users whose RLS lets them read it", () => {
  it("a Demo Bank user is never delivered a single Bank of Punjab row", async () => {
    for (const u of ["demoAdmin", "demoRegional", "demoOfficer", "demoAuditor"] as UserKey[]) {
      const v = await visibleTo(fx.users[u]);
      expect(v.bopLahore, u).toEqual(none);
      expect(v.bopFaisalabad, u).toEqual(none);
      expect(v.bopMultan, u).toEqual(none);
    }
  });

  it("a Bank of Punjab user is never delivered a Demo Bank row", async () => {
    for (const u of ["bopAdmin", "bopRegional", "bopOfficer", "bopAuditor"] as UserKey[]) {
      expect((await visibleTo(fx.users[u])).demoLahore, u).toEqual(none);
    }
  });

  it("organization admins and auditors receive their whole organization", async () => {
    for (const u of ["bopAdmin", "bopAuditor"] as UserKey[]) {
      const v = await visibleTo(fx.users[u]);
      expect([v.bopLahore, v.bopFaisalabad, v.bopMultan], u).toEqual([all, all, all]);
    }
    expect((await visibleTo(fx.users.demoAdmin)).demoLahore).toEqual(all);
  });

  it("a branch officer receives only their branch", async () => {
    const v = await visibleTo(fx.users.bopOfficer); // Lahore Main
    expect(v.bopLahore).toEqual(all);
    expect(v.bopFaisalabad).toEqual(none);
    expect(v.bopMultan).toEqual(none);
  });

  it("a regional manager receives only their region", async () => {
    const v = await visibleTo(fx.users.bopRegional); // Central Punjab: Lahore + Faisalabad
    expect(v.bopLahore).toEqual(all);
    expect(v.bopFaisalabad).toEqual(all);
    expect(v.bopMultan).toEqual(none);
  });

  it("an anonymous connection receives nothing", async () => {
    await asUser(db, null, async (q) => {
      for (const t of ["fixes", "alerts", "animals"]) {
        const p = await probe(q, `select id from public.${t} limit 1`);
        expect(p.ok, t).toBe(false);
        expect(p.code, t).toBe("42501");
      }
    });
  });

  it("a user in both organizations is delivered both, which is why the client also filters by organization", async () => {
    const v = await visibleTo(fx.users.both);
    expect(v.bopLahore).toEqual(all);
    expect(v.demoLahore).toEqual(all);
  });

  it("control: with RLS off the same Demo Bank user WOULD be delivered the Bank of Punjab row (the check is not vacuous)", async () => {
    await db.query("alter table public.fixes disable row level security");
    try {
      const seen = await asUser(db, fx.users.demoAdmin, (q) => idsIn(q, "fixes", [written.bopLahore.fix]));
      expect(seen).toEqual([written.bopLahore.fix]);
    } finally {
      await db.query("alter table public.fixes enable row level security");
    }
    const after = await asUser(db, fx.users.demoAdmin, (q) => idsIn(q, "fixes", [written.bopLahore.fix]));
    expect(after).toEqual([]);
  });
});
