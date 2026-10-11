/**
 * Test data for the RLS suite. Inserted as the database owner (which is not subject to RLS), then
 * every assertion runs as a real end user through `asUser`.
 *
 * Two organizations with deliberately overlapping names and structure, so isolation cannot pass
 * by accident:
 *
 *   Bank of Punjab   regions: Central Punjab (R1), South Punjab (R2)
 *                    branches: Lahore Main (R1), Faisalabad Main (R1), Multan Main (R2)
 *                    2 animals per branch, each with tag, borrower, loan, fixes, fence, alert
 *   Demo Bank        regions: Central Punjab (R1)            <- same name as Bank of Punjab's
 *                    branches: Lahore Main, Faisalabad Main  <- same names, same codes
 *                    2 animals per branch
 */
import type { Query, Row } from "./backend";

export type UserKey =
  | "bopAdmin" | "bopRegional" | "bopOfficer" | "bopAuditor"
  | "demoAdmin" | "demoRegional" | "demoOfficer" | "demoAuditor"
  | "platform" | "both" | "outsider";

export interface OrgFixture {
  id: string;
  regions: Record<string, number>;
  /** branch key -> branch id */
  branches: Record<string, number>;
  /** branch key -> region key */
  branchRegion: Record<string, string>;
  /** branch key -> animal ids */
  animals: Record<string, number[]>;
  /** branch key -> alert ids */
  alerts: Record<string, number[]>;
  tags: number[];
  unassignedTagId: number;
  /** A fence referenced by every animal of the organization. */
  geofenceId: number;
  /** A fence nothing references, safe to delete in a probe. */
  spareGeofenceId: number;
  /** The organization's device API key (a uuid). */
  deviceKeyId: string;
}

export interface Fixtures {
  bop: OrgFixture;
  demo: OrgFixture;
  users: Record<UserKey, string>;
}

async function ins(q: Query, table: string, row: Row): Promise<number> {
  const cols = Object.keys(row);
  const sql = `insert into public.${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`;
  const r = await q(sql, cols.map((c) => row[c]));
  return r.rows[0].id as number;
}

async function insertUser(q: Query, email: string, name: string): Promise<string> {
  // The auth.users trigger creates the matching public.profiles row.
  const r = await q(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ full_name: name })],
  );
  return r.rows[0].id as string;
}

async function buildOrg(
  q: Query,
  name: string,
  slug: string,
  prefix: string,
  layout: Array<{ branch: string; region: string; code: string }>,
  regionNames: Record<string, string>,
): Promise<OrgFixture> {
  const org = (
    await q("insert into public.organizations (name, slug) values ($1, $2) returning id", [name, slug])
  ).rows[0].id as string;

  const regions: Record<string, number> = {};
  for (const [key, regionName] of Object.entries(regionNames)) {
    regions[key] = await ins(q, "regions", { organization_id: org, name: regionName, code: key.toUpperCase() });
  }

  const geofenceId = await ins(q, "geofences", {
    organization_id: org, name: `${name} fence`, type: "district", geom: "g", district_name: "Lahore",
  });

  const fx: OrgFixture = {
    id: org, regions, branches: {}, branchRegion: {}, animals: {}, alerts: {}, tags: [],
    unassignedTagId: 0, geofenceId, spareGeofenceId: 0, deviceKeyId: "",
  };

  let n = 0;
  for (const b of layout) {
    const branchId = await ins(q, "branches", {
      organization_id: org, name: b.branch, code: b.code, region_id: regions[b.region],
    });
    fx.branches[b.branch] = branchId;
    fx.branchRegion[b.branch] = b.region;
    fx.animals[b.branch] = [];
    fx.alerts[b.branch] = [];

    for (let i = 0; i < 2; i++) {
      n++;
      const borrower = await ins(q, "borrowers", {
        organization_id: org, name: `${prefix} Borrower ${n}`, cnic: `${prefix}-${n}`, branch_id: branchId,
      });
      const loan = await ins(q, "loans", {
        organization_id: org, loan_number: `${prefix}-LN-${n}`, borrower_id: borrower,
        branch_id: branchId, amount_pkr: 100000 + n,
      });
      const tag = await ins(q, "tags", {
        organization_id: org, serial_number: `${prefix}-TAG-${n}`, is_simulated: true,
      });
      fx.tags.push(tag);
      const animal = await ins(q, "animals", {
        organization_id: org, name: `${prefix} Animal ${n}`, tag_id: tag, borrower_id: borrower,
        loan_id: loan, branch_id: branchId, district: "Lahore", status: "inside",
      });
      fx.animals[b.branch].push(animal);

      for (let f = 0; f < 2; f++) {
        await ins(q, "fixes", {
          organization_id: org, tag_id: tag, animal_id: animal,
          lat: 31.5 + f / 100, lon: 74.3, fixed_at: new Date(Date.UTC(2026, 9, 9, 10, f)).toISOString(),
        });
      }
      await ins(q, "animal_geofence", { organization_id: org, animal_id: animal, geofence_id: geofenceId, is_active: true });

      const alert = await ins(q, "alerts", {
        organization_id: org, animal_id: animal, tag_id: tag, type: "breach", severity: "critical",
        status: "new", title: `${prefix} breach ${n}`,
      });
      fx.alerts[b.branch].push(alert);
      await ins(q, "alert_events", { organization_id: org, alert_id: alert, to_status: "new" });
    }
  }

  fx.spareGeofenceId = await ins(q, "geofences", {
    organization_id: org, name: `${name} spare fence`, type: "radius", geom: "g",
  });
  fx.deviceKeyId = (
    await q(
      "insert into public.device_api_keys (organization_id, key_hash, key_prefix, label) values ($1, $2, 'bs_fix', $3) returning id",
      [org, (prefix === "BOP" ? "e1" : "e2").repeat(32), `${name} key`],
    )
  ).rows[0].id as string;
  fx.unassignedTagId = await ins(q, "tags", {
    organization_id: org, serial_number: `${prefix}-TAG-SPARE`, is_simulated: false,
  });
  return fx;
}

export async function seedFixtures(q: Query): Promise<Fixtures> {
  const bop = await buildOrg(
    q, "Bank of Punjab", "bank-of-punjab", "BOP",
    [
      { branch: "Lahore Main", region: "r1", code: "LHE-001" },
      { branch: "Faisalabad Main", region: "r1", code: "FSD-001" },
      { branch: "Multan Main", region: "r2", code: "MLT-001" },
    ],
    { r1: "Central Punjab", r2: "South Punjab" },
  );
  const demo = await buildOrg(
    q, "Demo Bank", "demo-bank", "DEMO",
    [
      { branch: "Lahore Main", region: "r1", code: "LHE-001" },
      { branch: "Faisalabad Main", region: "r1", code: "FSD-001" },
    ],
    { r1: "Central Punjab" },
  );

  const users = {} as Record<UserKey, string>;
  for (const key of [
    "bopAdmin", "bopRegional", "bopOfficer", "bopAuditor",
    "demoAdmin", "demoRegional", "demoOfficer", "demoAuditor",
    "platform", "both", "outsider",
  ] as UserKey[]) {
    users[key] = await insertUser(q, `${key}@rls.test`, key);
  }

  const member = (user: UserKey, org: OrgFixture, role: string, region?: string, branch?: string) =>
    ins(q, "memberships", {
      user_id: users[user], organization_id: org.id, role,
      region_id: region ? org.regions[region] : null,
      branch_id: branch ? org.branches[branch] : null,
    });

  await member("bopAdmin", bop, "org_admin");
  await member("bopRegional", bop, "regional_manager", "r1");
  await member("bopOfficer", bop, "branch_officer", undefined, "Lahore Main");
  await member("bopAuditor", bop, "auditor");
  await member("demoAdmin", demo, "org_admin");
  await member("demoRegional", demo, "regional_manager", "r1");
  await member("demoOfficer", demo, "branch_officer", undefined, "Lahore Main");
  await member("demoAuditor", demo, "auditor");
  await member("both", bop, "auditor");
  await member("both", demo, "auditor");

  await q("insert into public.platform_admins (user_id) values ($1)", [users.platform]);

  return { bop, demo, users };
}
