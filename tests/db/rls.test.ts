/**
 * Row Level Security tests: the database itself must refuse what the roles may not do.
 *
 * Every assertion runs as a real end user (the `authenticated` role with that user's JWT
 * subject), exactly as Supabase's API would, against the real migrations. Fixtures are inserted
 * once as the database owner. Everything happens in one transaction that is rolled back at the
 * end, and each write attempt is additionally rolled back by `probe`.
 *
 * Backend: PGlite by default; set TEST_DATABASE_URL to run the same tests on a Supabase test
 * project / local supabase database (see tests/db/backend.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, probe, refused, type Query, type TestDb } from "./backend";
import { seedFixtures, type Fixtures, type OrgFixture, type UserKey } from "./fixtures";
import { can, ORG_ROLES, PERMISSIONS, type AppRole, type Permission } from "../../src/lib/permissions";

let db: TestDb;
let fx: Fixtures;

beforeAll(async () => {
  db = await createTestDb();
  await db.query("begin");
  fx = await seedFixtures(db.query);
});

afterAll(async () => {
  await db.query("rollback");
  await db.close();
});

// ─── helpers ─────────────────────────────────────────────────────────────────────────────────
const BUSINESS_TABLES = [
  "regions", "branches", "borrowers", "loans", "geofences", "tags", "animals",
  "animal_geofence", "fixes", "alerts", "alert_events",
] as const;
const ORG_VIEWS = [
  "animal_overview", "alert_overview", "alert_audit", "geofence_overview", "geofence_detail",
  "kpi_summary",
] as const;

const n = async (q: Query, sql: string, params?: unknown[]) =>
  Number((await q(sql, params)).rows[0].n);
const ids = async (q: Query, sql: string, params?: unknown[]) =>
  (await q(sql, params)).rows.map((r) => Number(Object.values(r)[0])).sort((a, b) => a - b);
const flat = (...xs: number[][]) => xs.flat().sort((a, b) => a - b);
const branchesOf = (o: OrgFixture, ...keys: string[]) => keys.map((k) => o.branches[k]).sort((a, b) => a - b);
const animalsOf = (o: OrgFixture, ...keys: string[]) => flat(...keys.map((k) => o.animals[k]));
const alertsOf = (o: OrgFixture, ...keys: string[]) => flat(...keys.map((k) => o.alerts[k]));
const total = (o: OrgFixture, table: string) =>
  // rows of that org, counted as the database owner (not subject to RLS)
  n(db.query, `select count(*)::int n from public.${table} where organization_id = $1`, [o.id]);

const LAHORE = "Lahore Main";
const FAISALABAD = "Faisalabad Main";
const MULTAN = "Multan Main";

// ─── 1. tenant isolation ─────────────────────────────────────────────────────────────────────
describe("tenant isolation: a Demo Bank user cannot read a single Bank of Punjab row", () => {
  const demoUsers: UserKey[] = ["demoAdmin", "demoRegional", "demoOfficer", "demoAuditor"];

  for (const u of demoUsers) {
    it(`${u} sees zero Bank of Punjab rows in any table or view`, async () => {
      await asUser(db, fx.users[u], async (q) => {
        for (const t of BUSINESS_TABLES) {
          expect(await n(q, `select count(*)::int n from public.${t} where organization_id = $1`, [fx.bop.id]), t).toBe(0);
        }
        for (const v of ORG_VIEWS) {
          expect(await n(q, `select count(*)::int n from public.${v} where organization_id = $1`, [fx.bop.id]), v).toBe(0);
        }
        expect(await n(q, "select count(*)::int n from public.organizations where id = $1", [fx.bop.id])).toBe(0);
        expect(await n(q, "select count(*)::int n from public.memberships where organization_id = $1", [fx.bop.id])).toBe(0);
        const bopOnlyPeople = [fx.users.bopAdmin, fx.users.bopRegional, fx.users.bopOfficer, fx.users.bopAuditor];
        expect(await n(q, "select count(*)::int n from public.profiles where id = any($1::uuid[])", [bopOnlyPeople])).toBe(0);
      });
    });
  }

  it("a Demo Bank user cannot see a Bank of Punjab device key", async () => {
    for (const u of demoUsers) {
      await asUser(db, fx.users[u], async (q) => {
        expect(await n(q, "select count(*)::int n from public.device_api_keys where organization_id = $1", [fx.bop.id]), u).toBe(0);
        expect(await n(q, "select count(*)::int n from public.device_api_keys where id = $1", [fx.bop.deviceKeyId]), u).toBe(0);
      });
    }
  });

  it("a Demo Bank user cannot fetch a Bank of Punjab row even by its exact id", async () => {
    await asUser(db, fx.users.demoAdmin, async (q) => {
      expect(await ids(q, "select id from public.animals where id = any($1::int[])", [animalsOf(fx.bop, LAHORE, FAISALABAD, MULTAN)])).toEqual([]);
      expect(await ids(q, "select id from public.alerts where id = any($1::int[])", [alertsOf(fx.bop, LAHORE, FAISALABAD, MULTAN)])).toEqual([]);
      expect(await ids(q, "select id from public.branches where id = any($1::int[])", [branchesOf(fx.bop, LAHORE, FAISALABAD, MULTAN)])).toEqual([]);
    });
  });

  it("control: the same users DO see their own organization (the check is not vacuous)", async () => {
    await asUser(db, fx.users.demoAdmin, async (q) => {
      for (const t of BUSINESS_TABLES) {
        const mine = await n(q, `select count(*)::int n from public.${t}`);
        expect(mine, t).toBeGreaterThan(0);
        // everything the admin sees is exactly Demo Bank's rows: no more, no less
        expect(mine, t).toBe(await total(fx.demo, t));
      }
    });
  });

  it("negative control: with RLS switched off the same query DOES see Bank of Punjab", async () => {
    await db.query("savepoint nc");
    try {
      await db.query("alter table public.animals disable row level security");
      const leaked = await asUser(db, fx.users.demoAdmin, (q) =>
        n(q, "select count(*)::int n from public.animals where organization_id = $1", [fx.bop.id]),
      );
      expect(leaked).toBeGreaterThan(0);
    } finally {
      await db.query("rollback to savepoint nc");
      await db.query("release savepoint nc");
    }
    const after = await asUser(db, fx.users.demoAdmin, (q) =>
      n(q, "select count(*)::int n from public.animals where organization_id = $1", [fx.bop.id]),
    );
    expect(after).toBe(0);
  });

  it("a Demo Bank admin cannot write into Bank of Punjab", async () => {
    await asUser(db, fx.users.demoAdmin, async (q) => {
      const bopAnimal = fx.bop.animals[LAHORE][0];
      const bopAlert = fx.bop.alerts[LAHORE][0];
      expect(refused(await probe(q, "update public.animals set name = 'x' where id = $1 returning id", [bopAnimal]))).toBe(true);
      expect(refused(await probe(q, "delete from public.animals where id = $1 returning id", [bopAnimal]))).toBe(true);
      expect(refused(await probe(q, "update public.alerts set status = 'acknowledged' where id = $1 returning id", [bopAlert]))).toBe(true);
      expect(refused(await probe(q, "update public.organizations set settings = '{}' where id = $1 returning id", [fx.bop.id]))).toBe(true);
      // creating rows inside the other tenant is rejected outright
      const region = await probe(q, "insert into public.regions (organization_id, name, code) values ($1, 'Intruder', 'X') returning id", [fx.bop.id]);
      expect(region.ok).toBe(false);
      expect(region.code).toBe("42501");
      const geofence = await probe(q, "insert into public.geofences (organization_id, name, type, geom) values ($1, 'x', 'radius', 'g') returning id", [fx.bop.id]);
      expect(geofence.ok).toBe(false);
      const member = await probe(q, "insert into public.memberships (user_id, organization_id, role) values ($1, $2, 'org_admin') returning id", [fx.users.outsider, fx.bop.id]);
      expect(member.ok).toBe(false);
    });
  });

  it("a Demo Bank admin cannot move its own data into Bank of Punjab", async () => {
    await asUser(db, fx.users.demoAdmin, async (q) => {
      const own = fx.demo.animals[LAHORE][0];
      const move = await probe(q, "update public.animals set organization_id = $1 where id = $2 returning id", [fx.bop.id, own]);
      expect(refused(move)).toBe(true);
    });
  });
});

// ─── 2. auditor ──────────────────────────────────────────────────────────────────────────────
describe("auditor: read-only", () => {
  it("can read the whole organization", async () => {
    await asUser(db, fx.users.bopAuditor, async (q) => {
      for (const t of BUSINESS_TABLES) {
        expect(await n(q, `select count(*)::int n from public.${t}`), t).toBe(await total(fx.bop, t));
      }
    });
  });

  it("cannot update, insert or delete anything", async () => {
    const org = fx.bop.id;
    const alert = fx.bop.alerts[LAHORE][0];
    const animal = fx.bop.animals[LAHORE][0];
    const attempts: Array<[string, string, unknown[]]> = [
      ["acknowledge an alert", "update public.alerts set status = 'acknowledged' where id = $1 returning id", [alert]],
      ["resolve an alert", "update public.alerts set status = 'resolved', resolution_reason = 'false_alarm' where id = $1 returning id", [alert]],
      ["assign an alert", "update public.alerts set status = 'assigned', assignee_id = $2 where id = $1 returning id", [alert, fx.users.bopOfficer]],
      ["edit an animal", "update public.animals set name = 'x' where id = $1 returning id", [animal]],
      ["delete an animal", "delete from public.animals where id = $1 returning id", [animal]],
      ["edit a geofence", "update public.geofences set name = 'x' where id = $1 returning id", [fx.bop.geofenceId]],
      ["delete a geofence", "delete from public.geofences where id = $1 returning id", [fx.bop.spareGeofenceId]],
      ["create a geofence", "insert into public.geofences (organization_id, name, type, geom) values ($1, 'x', 'radius', 'g') returning id", [org]],
      ["edit a region", "update public.regions set name = 'x' where organization_id = $1 returning id", [org]],
      ["edit a branch", "update public.branches set name = 'x' where organization_id = $1 returning id", [org]],
      ["edit a borrower", "update public.borrowers set name = 'x' where organization_id = $1 returning id", [org]],
      ["edit a loan", "update public.loans set amount_pkr = 1 where organization_id = $1 returning id", [org]],
      ["edit a tag", "update public.tags set is_simulated = false where organization_id = $1 returning id", [org]],
      ["edit fence assignments", "update public.animal_geofence set is_active = false where organization_id = $1 returning id", [org]],
      ["edit organization settings", "update public.organizations set settings = '{}' where id = $1 returning id", [org]],
      ["promote themselves", "update public.memberships set role = 'org_admin' where user_id = $1 returning id", [fx.users.bopAuditor]],
      ["add a member", "insert into public.memberships (user_id, organization_id, role) values ($1, $2, 'auditor') returning id", [fx.users.outsider, org]],
      ["remove a member", "delete from public.memberships where organization_id = $1 returning id", [org]],
      ["write an audit event", "insert into public.alert_events (organization_id, alert_id, to_status, user_id) values ($1, $2, 'acknowledged', $3) returning id", [org, alert, fx.users.bopAuditor]],
      ["write a fix", "insert into public.fixes (organization_id, tag_id, lat, lon, fixed_at) values ($1, $2, 1, 1, now()) returning id", [org, fx.bop.tags[0]]],
      ["edit someone else's profile", "update public.profiles set full_name = 'x' where id = $1 returning id", [fx.users.bopAdmin]],
    ];

    await asUser(db, fx.users.bopAuditor, async (q) => {
      for (const [what, sql, params] of attempts) {
        expect(refused(await probe(q, sql, params)), `auditor must not be able to ${what}`).toBe(true);
      }
    });

    // and nothing changed underneath
    expect(await n(db.query, "select count(*)::int n from public.alerts where organization_id = $1 and status <> 'new'", [org])).toBe(0);
    expect(await n(db.query, "select count(*)::int n from public.geofences where organization_id = $1", [org])).toBe(2);
  });

  it("the one thing every user may edit is their own profile (name, phone)", async () => {
    await asUser(db, fx.users.bopAuditor, async (q) => {
      const own = await probe(q, "update public.profiles set full_name = 'Renamed' where id = $1 returning id", [fx.users.bopAuditor]);
      expect(own.ok && own.rows.length === 1).toBe(true);
    });
  });
});

// ─── 3. branch officer ───────────────────────────────────────────────────────────────────────
describe("branch officer: confined to their branch", () => {
  const mine = () => animalsOf(fx.bop, LAHORE);
  const others = () => animalsOf(fx.bop, FAISALABAD, MULTAN);

  it("sees only their branch's animals, borrowers, loans, fixes, alerts, events and fences", async () => {
    await asUser(db, fx.users.bopOfficer, async (q) => {
      expect(await ids(q, "select id from public.animals")).toEqual(mine());
      expect(await n(q, "select count(*)::int n from public.borrowers")).toBe(2);
      expect(await n(q, "select count(*)::int n from public.loans")).toBe(2);
      expect(await n(q, "select count(*)::int n from public.fixes")).toBe(4);
      expect(await ids(q, "select id from public.alerts")).toEqual(alertsOf(fx.bop, LAHORE));
      expect(await n(q, "select count(*)::int n from public.alert_events")).toBe(2);
      expect(await n(q, "select count(*)::int n from public.animal_geofence")).toBe(2);
    });
  });

  it("cannot see another branch by id, name or relationship", async () => {
    await asUser(db, fx.users.bopOfficer, async (q) => {
      expect(await ids(q, "select id from public.animals where id = any($1::int[])", [others()])).toEqual([]);
      expect(await ids(q, "select id from public.alerts where id = any($1::int[])", [alertsOf(fx.bop, FAISALABAD, MULTAN)])).toEqual([]);
      expect(await n(q, "select count(*)::int n from public.fixes where animal_id = any($1::int[])", [others()])).toBe(0);
      expect(await n(q, "select count(*)::int n from public.borrowers where name like 'BOP Borrower %' and branch_id <> $1", [fx.bop.branches[LAHORE]])).toBe(0);
      expect(await ids(q, "select id from public.branches")).toEqual(branchesOf(fx.bop, LAHORE));
      expect(await ids(q, "select id from public.regions")).toEqual([fx.bop.regions.r1]);
    });
  });

  it("sees their branch's tags only (not other branches' or spare inventory)", async () => {
    await asUser(db, fx.users.bopOfficer, async (q) => {
      const tags = await ids(q, "select id from public.tags");
      expect(tags).toEqual([...fx.bop.tags.slice(0, 2)].sort((a, b) => a - b));
      expect(tags).not.toContain(fx.bop.unassignedTagId);
    });
  });

  it("dashboard views and KPIs are scoped to the branch too", async () => {
    await asUser(db, fx.users.bopOfficer, async (q) => {
      expect(await ids(q, "select id from public.animal_overview")).toEqual(mine());
      expect(await ids(q, "select id from public.alert_overview")).toEqual(alertsOf(fx.bop, LAHORE));
      const kpi = (await q("select branch_id, total from public.kpi_summary")).rows;
      expect(kpi).toHaveLength(1);
      expect(Number(kpi[0].branch_id)).toBe(fx.bop.branches[LAHORE]);
      expect(Number(kpi[0].total)).toBe(2);
    });
  });

  it("can work alerts in their branch but not in another branch", async () => {
    await asUser(db, fx.users.bopOfficer, async (q) => {
      const own = await probe(q, "update public.alerts set status = 'acknowledged', acknowledged_at = now() where id = $1 returning id", [fx.bop.alerts[LAHORE][0]]);
      expect(own.ok && own.rows.length === 1, "own branch").toBe(true);
      for (const other of [fx.bop.alerts[FAISALABAD][0], fx.bop.alerts[MULTAN][0]]) {
        const p = await probe(q, "update public.alerts set status = 'acknowledged' where id = $1 returning id", [other]);
        expect(refused(p), `alert ${other} in another branch`).toBe(true);
      }
      const event = await probe(
        q,
        "insert into public.alert_events (organization_id, alert_id, to_status, user_id) values ($1, $2, 'acknowledged', $3) returning id",
        [fx.bop.id, fx.bop.alerts[FAISALABAD][0], fx.users.bopOfficer],
      );
      expect(event.ok, "audit event on another branch's alert").toBe(false);
    });
  });
});

// ─── 3b. regional manager ────────────────────────────────────────────────────────────────────
describe("regional manager: confined to their region", () => {
  it("sees the branches of their region only", async () => {
    await asUser(db, fx.users.bopRegional, async (q) => {
      expect(await ids(q, "select id from public.branches")).toEqual(branchesOf(fx.bop, LAHORE, FAISALABAD));
      expect(await ids(q, "select id from public.regions")).toEqual([fx.bop.regions.r1]);
      expect(await ids(q, "select id from public.animals")).toEqual(animalsOf(fx.bop, LAHORE, FAISALABAD));
      expect(await ids(q, "select id from public.alerts")).toEqual(alertsOf(fx.bop, LAHORE, FAISALABAD));
      expect(await ids(q, "select id from public.animals where id = any($1::int[])", [animalsOf(fx.bop, MULTAN)])).toEqual([]);
    });
  });

  it("can work alerts inside the region, not in another region", async () => {
    await asUser(db, fx.users.bopRegional, async (q) => {
      for (const ok of [fx.bop.alerts[LAHORE][0], fx.bop.alerts[FAISALABAD][0]]) {
        const p = await probe(q, "update public.alerts set status = 'acknowledged' where id = $1 returning id", [ok]);
        expect(p.ok && p.rows.length === 1).toBe(true);
      }
      const out = await probe(q, "update public.alerts set status = 'acknowledged' where id = $1 returning id", [fx.bop.alerts[MULTAN][0]]);
      expect(refused(out)).toBe(true);
    });
  });
});

// ─── 4. who may do what: the database against lib/permissions.ts ─────────────────────────────
describe("role x permission matrix: database behaviour equals lib/permissions.ts", () => {
  const actors: Array<{ role: AppRole; user: UserKey }> = [
    { role: "org_admin", user: "bopAdmin" },
    { role: "regional_manager", user: "bopRegional" },
    { role: "branch_officer", user: "bopOfficer" },
    { role: "auditor", user: "bopAuditor" },
    { role: "platform_admin", user: "platform" }, // not a member of Bank of Punjab
  ];

  // One attempt per permission, aimed at Bank of Punjab's Lahore branch (inside every scope).
  function attempts(actor: string): Record<Permission, Array<[string, string, unknown[]]>> {
    const alert = fx.bop.alerts[LAHORE][0];
    const org = fx.bop.id;
    return {
      "alerts:acknowledge": [["acknowledge", "update public.alerts set status = 'acknowledged', acknowledged_at = now() where id = $1 returning id", [alert]]],
      "alerts:assign": [["assign", "update public.alerts set status = 'assigned', assigned_at = now(), assignee_id = $2 where id = $1 returning id", [alert, fx.users.bopOfficer]]],
      "alerts:resolve": [["resolve", "update public.alerts set status = 'resolved', resolved_at = now(), resolution_reason = 'false_alarm' where id = $1 returning id", [alert]]],
      "geofences:manage": [
        ["create fence", "insert into public.geofences (organization_id, name, type, geom) values ($1, 'new', 'radius', 'g') returning id", [org]],
        ["edit fence", "update public.geofences set name = 'renamed' where id = $1 returning id", [fx.bop.geofenceId]],
        ["delete fence", "delete from public.geofences where id = $1 returning id", [fx.bop.spareGeofenceId]],
        ["assign fence", "update public.animal_geofence set is_active = false where organization_id = $1 returning id", [org]],
      ],
      "users:manage": [
        ["add member", "insert into public.memberships (user_id, organization_id, role) values ($1, $2, 'auditor') returning id", [fx.users.outsider, org]],
        ["change role", "update public.memberships set role = 'auditor' where user_id = $1 and organization_id = $2 returning id", [fx.users.bopAuditor, org]],
        ["remove member", "delete from public.memberships where user_id = $1 and organization_id = $2 returning id", [fx.users.bopAuditor, org]],
      ],
      "devices:manage": [
        ["create key", "insert into public.device_api_keys (organization_id, key_hash, key_prefix, label, created_by) values ($1, repeat('d', 64), 'bs_d', 'k', $2) returning id", [org, actor]],
        ["revoke key", "update public.device_api_keys set revoked_at = now() where id = $1 returning id", [fx.bop.deviceKeyId]],
      ],
      "settings:manage": [
        ["edit settings", "update public.organizations set settings = '{\"k\": 1}' where id = $1 returning id", [org]],
        ["edit regions", "update public.regions set name = 'renamed' where id = $1 returning id", [fx.bop.regions.r1]],
        ["edit branches", "update public.branches set name = 'renamed' where id = $1 returning id", [fx.bop.branches[LAHORE]]],
      ],
    };
  }

  for (const { role, user } of actors) {
    for (const permission of PERMISSIONS) {
      it(`${role} ${can(role, permission) ? "CAN" : "cannot"} ${permission}`, async () => {
        await asUser(db, fx.users[user], async (q) => {
          for (const [what, sql, params] of attempts(fx.users[user])[permission]) {
            const p = await probe(q, sql, params);
            const allowed = p.ok && p.rows.length > 0;
            expect(allowed, `${role}: ${what} (${permission}) — database said ${allowed ? "yes" : `no${p.code ? " [" + p.code + "]" : ""}`}`).toBe(can(role, permission));
          }
        });
      });
    }
  }

  it("the matrix covers every organization role", () => {
    expect([...ORG_ROLES].sort()).toEqual(["auditor", "branch_officer", "org_admin", "regional_manager"]);
  });
});

// ─── 5. platform admin ───────────────────────────────────────────────────────────────────────
describe("platform admin: reads across organizations through an explicit clause, writes nothing", () => {
  it("reads every organization", async () => {
    await asUser(db, fx.users.platform, async (q) => {
      for (const t of BUSINESS_TABLES) {
        expect(await n(q, `select count(*)::int n from public.${t}`), t).toBe((await total(fx.bop, t)) + (await total(fx.demo, t)));
      }
      expect(await n(q, "select count(*)::int n from public.organizations")).toBe(2);
      expect(await n(q, "select count(*)::int n from public.animal_overview")).toBe(10);
    });
  });

  it("is not a member of any organization (the read comes from the platform clause)", async () => {
    await asUser(db, fx.users.platform, async (q) => {
      expect(await n(q, "select count(*)::int n from public.current_org_ids()")).toBe(0);
      expect((await q("select public.is_platform_admin() as v")).rows[0].v).toBe(true);
    });
  });

  it("cannot write: no alert changes, no fences, no members, no settings", async () => {
    await asUser(db, fx.users.platform, async (q) => {
      const a = fx.bop.alerts[LAHORE][0];
      expect(refused(await probe(q, "update public.alerts set status = 'acknowledged' where id = $1 returning id", [a]))).toBe(true);
      expect(refused(await probe(q, "delete from public.animals where organization_id = $1 returning id", [fx.demo.id]))).toBe(true);
      expect(refused(await probe(q, "update public.organizations set name = 'x' where id = $1 returning id", [fx.bop.id]))).toBe(true);
      expect((await probe(q, "insert into public.geofences (organization_id, name, type, geom) values ($1, 'x', 'radius', 'g') returning id", [fx.bop.id])).ok).toBe(false);
    });
  });

  it("can write its own access-audit entry, and only its own", async () => {
    await asUser(db, fx.users.platform, async (q) => {
      const own = await probe(q, "insert into public.platform_audit_log (user_id, organization_id, action) values ($1, $2, 'select_organization') returning id", [fx.users.platform, fx.bop.id]);
      expect(own.ok).toBe(true);
      const forged = await probe(q, "insert into public.platform_audit_log (user_id, organization_id, action) values ($1, $2, 'select_organization') returning id", [fx.users.bopAdmin, fx.bop.id]);
      expect(forged.ok).toBe(false);
      expect(await n(q, "select count(*)::int n from public.platform_audit_log")).toBe(0); // probes were rolled back
    });
  });

  it("an ordinary user cannot read the platform tables or claim platform access", async () => {
    await db.query("insert into public.platform_audit_log (user_id, organization_id, action) values ($1, $2, 'seed')", [fx.users.platform, fx.bop.id]);
    await asUser(db, fx.users.bopAdmin, async (q) => {
      expect(await n(q, "select count(*)::int n from public.platform_audit_log")).toBe(0);
      expect(await n(q, "select count(*)::int n from public.platform_admins")).toBe(0);
      expect((await q("select public.is_platform_admin() as v")).rows[0].v).toBe(false);
      expect((await probe(q, "insert into public.platform_admins (user_id) values ($1) returning user_id", [fx.users.bopAdmin])).ok).toBe(false);
      expect((await probe(q, "insert into public.platform_audit_log (user_id, organization_id, action) values ($1, $2, 'x') returning id", [fx.users.bopAdmin, fx.bop.id])).ok).toBe(false);
    });
  });
});

// ─── 6. users who belong nowhere / everywhere ────────────────────────────────────────────────
describe("membership boundaries", () => {
  it("a signed-in user with no membership sees nothing at all", async () => {
    await asUser(db, fx.users.outsider, async (q) => {
      for (const t of [...BUSINESS_TABLES, "organizations", "memberships"]) {
        expect(await n(q, `select count(*)::int n from public.${t}`), t).toBe(0);
      }
      for (const v of ORG_VIEWS) expect(await n(q, `select count(*)::int n from public.${v}`), v).toBe(0);
    });
  });

  it("a user in both organizations sees both, read-only", async () => {
    await asUser(db, fx.users.both, async (q) => {
      expect(await n(q, "select count(*)::int n from public.animals")).toBe(10);
      expect(await n(q, "select count(*)::int n from public.organizations")).toBe(2);
      expect(refused(await probe(q, "update public.animals set name = 'x' returning id"))).toBe(true);
    });
  });

  it("a suspended organization locks its members out, but not the platform admin's read", async () => {
    await db.query("savepoint susp");
    try {
      await db.query("update public.organizations set status = 'suspended' where id = $1", [fx.bop.id]);
      await asUser(db, fx.users.bopAdmin, async (q) => {
        expect(await n(q, "select count(*)::int n from public.animals")).toBe(0);
        expect(refused(await probe(q, "update public.organizations set settings = '{}' where id = $1 returning id", [fx.bop.id]))).toBe(true);
      });
      await asUser(db, fx.users.platform, async (q) => {
        expect(await n(q, "select count(*)::int n from public.animals where organization_id = $1", [fx.bop.id])).toBe(6);
      });
    } finally {
      await db.query("rollback to savepoint susp");
      await db.query("release savepoint susp");
    }
  });
});

// ─── 7. helper functions ─────────────────────────────────────────────────────────────────────
describe("helper functions", () => {
  it("current_org_ids()", async () => {
    const orgs = async (u: UserKey) =>
      asUser(db, fx.users[u], async (q) => (await q("select public.current_org_ids() as id")).rows.map((r) => r.id as string).sort());
    expect(await orgs("bopAdmin")).toEqual([fx.bop.id]);
    expect(await orgs("demoOfficer")).toEqual([fx.demo.id]);
    expect(await orgs("both")).toEqual([fx.bop.id, fx.demo.id].sort());
    expect(await orgs("outsider")).toEqual([]);
    expect(await orgs("platform")).toEqual([]);
  });

  it("has_role(org, role) is exact and organization-specific", async () => {
    const has = (u: UserKey, org: string, role: string) =>
      asUser(db, fx.users[u], async (q) => (await q("select public.has_role($1, $2) as v", [org, role])).rows[0].v as boolean);
    expect(await has("bopAdmin", fx.bop.id, "org_admin")).toBe(true);
    expect(await has("bopAdmin", fx.bop.id, "auditor")).toBe(false); // exact role, no implicit hierarchy
    expect(await has("bopAdmin", fx.demo.id, "org_admin")).toBe(false);
    expect(await has("bopOfficer", fx.bop.id, "branch_officer")).toBe(true);
    expect(await has("bopOfficer", fx.bop.id, "org_admin")).toBe(false);
    expect(await has("both", fx.demo.id, "auditor")).toBe(true);
    expect(await has("platform", fx.bop.id, "org_admin")).toBe(false);
  });

  it("user_branch_scope() returns the branches each role may see", async () => {
    const scope = (u: UserKey) =>
      asUser(db, fx.users[u], async (q) => ids(q, "select public.user_branch_scope() as id"));
    const all = (o: OrgFixture) => branchesOf(o, ...Object.keys(o.branches));
    expect(await scope("bopAdmin")).toEqual(all(fx.bop));
    expect(await scope("bopAuditor")).toEqual(all(fx.bop));
    expect(await scope("bopRegional")).toEqual(branchesOf(fx.bop, LAHORE, FAISALABAD));
    expect(await scope("bopOfficer")).toEqual(branchesOf(fx.bop, LAHORE));
    expect(await scope("demoOfficer")).toEqual(branchesOf(fx.demo, LAHORE));
    expect(await scope("both")).toEqual(flat(all(fx.bop), all(fx.demo)));
    expect(await scope("outsider")).toEqual([]);
    expect(await scope("platform")).toEqual([]);
  });

  it("helpers refuse anonymous callers", async () => {
    await asUser(db, null, async (q) => {
      for (const sql of ["select public.current_org_ids()", "select public.user_branch_scope()", "select public.is_platform_admin()"]) {
        const p = await probe(q, sql);
        expect(p.ok, sql).toBe(false);
        expect(p.code).toBe("42501");
      }
    });
  });
});

// ─── 8. audit trail and column-level protections ─────────────────────────────────────────────
describe("audit trail integrity", () => {
  const event = (actor: string, alert: number) =>
    ["insert into public.alert_events (organization_id, alert_id, from_status, to_status, user_id) values ($1, $2, 'new', 'acknowledged', $3) returning id", [fx.bop.id, alert, actor]] as const;

  it("an officer can log an event as themselves, never as someone else", async () => {
    await asUser(db, fx.users.bopOfficer, async (q) => {
      const own = event(fx.users.bopOfficer, fx.bop.alerts[LAHORE][0]);
      expect((await probe(q, own[0], [...own[1]])).ok).toBe(true);
      const forged = event(fx.users.bopAdmin, fx.bop.alerts[LAHORE][0]);
      expect(refused(await probe(q, forged[0], [...forged[1]]))).toBe(true);
      const anonymous = await probe(q, "insert into public.alert_events (organization_id, alert_id, to_status) values ($1, $2, 'acknowledged') returning id", [fx.bop.id, fx.bop.alerts[LAHORE][0]]);
      expect(refused(anonymous)).toBe(true); // user_id null != caller
    });
  });

  it("nobody, not even an org admin, can edit or delete audit events", async () => {
    for (const u of ["bopAdmin", "bopRegional", "bopOfficer"] as UserKey[]) {
      await asUser(db, fx.users[u], async (q) => {
        expect(refused(await probe(q, "update public.alert_events set note = 'tampered' returning id")), `${u} update`).toBe(true);
        expect(refused(await probe(q, "delete from public.alert_events returning id")), `${u} delete`).toBe(true);
      });
    }
  });
});

describe("column-level protections", () => {
  it("alert identity fields are immutable even for those who may work alerts", async () => {
    await asUser(db, fx.users.bopAdmin, async (q) => {
      const a = fx.bop.alerts[LAHORE][0];
      for (const set of ["title = 'x'", "severity = 'info'", "type = 'low_battery'", `organization_id = '${fx.demo.id}'`, "animal_id = animal_id + 1"]) {
        const p = await probe(q, `update public.alerts set ${set} where id = $1 returning id`, [a]);
        expect(p.ok, set).toBe(false);
        expect(p.code, set).toBe("42501");
      }
    });
  });

  it("an organization cannot change its own slug or suspend itself", async () => {
    await asUser(db, fx.users.bopAdmin, async (q) => {
      for (const set of ["status = 'suspended'", "slug = 'hijack'"]) {
        const p = await probe(q, `update public.organizations set ${set} where id = $1 returning id`, [fx.bop.id]);
        expect(p.ok, set).toBe(false);
        expect(p.code, set).toBe("42501");
      }
      const rename = await probe(q, "update public.organizations set name = 'Bank of Punjab Ltd' where id = $1 returning id", [fx.bop.id]);
      expect(rename.ok && rename.rows.length === 1).toBe(true);
    });
  });

  it("a membership cannot be re-pointed at another user or organization", async () => {
    await asUser(db, fx.users.bopAdmin, async (q) => {
      for (const set of [`user_id = '${fx.users.outsider}'`, `organization_id = '${fx.demo.id}'`]) {
        const p = await probe(q, `update public.memberships set ${set} where user_id = $1 returning id`, [fx.users.bopAuditor]);
        expect(p.ok, set).toBe(false);
        expect(p.code, set).toBe("42501");
      }
    });
  });

  it("nobody can write fixes through the API role (ingestion is a system path)", async () => {
    await asUser(db, fx.users.bopAdmin, async (q) => {
      const p = await probe(q, "insert into public.fixes (organization_id, tag_id, lat, lon, fixed_at) values ($1, $2, 1, 1, now()) returning id", [fx.bop.id, fx.bop.tags[0]]);
      expect(p.ok).toBe(false);
      expect(p.code).toBe("42501");
    });
  });

  it("an org admin cannot give an organization member a role in another organization", async () => {
    await asUser(db, fx.users.demoOfficer, async (q) => {
      const p = await probe(q, "insert into public.memberships (user_id, organization_id, role) values ($1, $2, 'org_admin') returning id", [fx.users.demoOfficer, fx.demo.id]);
      expect(refused(p), "officer promoting themselves").toBe(true);
    });
  });
});

// ─── 9. RPCs, anonymous access ───────────────────────────────────────────────────────────────
describe("create_geofence() runs under the caller's rights", () => {
  const call = (org: string) =>
    ["select public.create_geofence($1::uuid, 'T', 'polygon', 500, null, '{\"type\":\"Polygon\"}'::jsonb) as id", [org]] as const;

  it("an org admin can create a fence in their organization only", async () => {
    await asUser(db, fx.users.bopAdmin, async (q) => {
      const mine = call(fx.bop.id);
      expect((await probe(q, mine[0], [...mine[1]])).ok).toBe(true);
      const theirs = call(fx.demo.id);
      expect((await probe(q, theirs[0], [...theirs[1]])).ok).toBe(false);
    });
  });

  it("nobody else can, whatever their organization", async () => {
    for (const u of ["bopRegional", "bopOfficer", "bopAuditor", "platform"] as UserKey[]) {
      await asUser(db, fx.users[u], async (q) => {
        const c = call(fx.bop.id);
        const p = await probe(q, c[0], [...c[1]]);
        expect(p.ok, u).toBe(false);
        expect(p.code, u).toBe("42501");
      });
    }
  });
});

describe("views that call spatial functions work for end users", () => {
  it("geofence_detail returns the fence geometry to a branch officer (security_invoker + extensions usage)", async () => {
    await asUser(db, fx.users.bopOfficer, async (q) => {
      const rows = (await q("select id, geojson from public.geofence_detail")).rows;
      expect(rows.map((r) => Number(r.id)).sort((a, b) => a - b)).toEqual([fx.bop.geofenceId, fx.bop.spareGeofenceId].sort((a, b) => a - b));
      expect(rows[0].geojson).toBeTruthy();
    });
  });
});

describe("anonymous access", () => {
  it("the anon role cannot read any table or view", async () => {
    await asUser(db, null, async (q) => {
      const everything = [
        ...BUSINESS_TABLES, ...ORG_VIEWS, "organizations", "profiles", "memberships",
        "platform_admins", "platform_audit_log", "district_boundaries",
      ];
      for (const t of everything) {
        const p = await probe(q, `select 1 from public.${t} limit 1`);
        expect(p.ok, t).toBe(false);
        expect(p.code, t).toBe("42501");
      }
    });
  });

  it("the anon role cannot write", async () => {
    await asUser(db, null, async (q) => {
      expect((await probe(q, "update public.alerts set status = 'resolved' returning id")).ok).toBe(false);
      expect((await probe(q, "insert into public.regions (organization_id, name, code) values ($1, 'x', 'x') returning id", [fx.bop.id])).ok).toBe(false);
    });
  });
});

describe("shared reference data", () => {
  it("district boundaries are readable by any signed-in user and writable by none", async () => {
    await db.query("insert into public.district_boundaries (district_name, province, gadm_gid, geom) values ('Lahore', 'Punjab', 'G1', 'g')");
    await asUser(db, fx.users.demoOfficer, async (q) => {
      expect(await n(q, "select count(*)::int n from public.district_boundaries")).toBe(1);
      expect((await probe(q, "delete from public.district_boundaries returning id")).ok).toBe(false);
      expect((await probe(q, "insert into public.district_boundaries (district_name, geom) values ('x', 'g') returning id")).ok).toBe(false);
    });
  });
});
