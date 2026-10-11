/**
 * The demo seed and the constraint-check script must keep working on top of every migration,
 * including the RLS one (they run as the database owner, which RLS does not restrict).
 *
 * Skipped when TEST_DATABASE_URL is set: seeding writes real rows, and this suite must not do
 * that to a shared project.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./backend";

const SUPABASE = path.resolve(__dirname, "..", "..", "supabase");
const read = (...p: string[]) => fs.readFileSync(path.join(SUPABASE, ...p), "utf8");

describe.skipIf(Boolean(process.env.TEST_DATABASE_URL))("supabase/seed.sql", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.query(read("seed.sql"));
  });
  afterAll(async () => {
    await db.close();
  });

  const count = async (sql: string, params?: unknown[]) =>
    Number((await db.query(sql, params)).rows[0].n);

  it("creates Bank of Punjab (240 animals) and Demo Bank (14 animals)", async () => {
    const r = await db.query(
      `select o.slug, count(a.id)::int as n
         from public.organizations o left join public.animals a on a.organization_id = o.id
        group by o.slug order by o.slug`,
    );
    expect(r.rows.map((x) => [x.slug, x.n])).toEqual([["bank-of-punjab", 240], ["demo-bank", 14]]);
  });

  it("stamps every business row with its organization and reuses names across organizations", async () => {
    for (const t of ["regions", "branches", "borrowers", "loans", "geofences", "tags", "animals", "animal_geofence", "fixes"]) {
      expect(await count(`select count(*)::int n from public.${t} where organization_id is null`), t).toBe(0);
    }
    expect(await count("select count(*)::int n from public.branches where code = 'LHE-001'")).toBe(2);
  });

  it("is idempotent: running it again adds nothing", async () => {
    await db.query(read("seed.sql"));
    expect(await count("select count(*)::int n from public.animals")).toBe(254);
  });

  it("passes the cross-organization constraint checks (supabase/tests/tenancy_constraints.sql)", async () => {
    await db.query(read("tests", "tenancy_constraints.sql"));
  });

  it("seeded data is isolated by RLS: a Demo Bank member sees 14 animals and no Bank of Punjab row", async () => {
    // a member of Demo Bank only
    const demo = (await db.query("select id from public.organizations where slug = 'demo-bank'")).rows[0].id as string;
    const user = (await db.query("insert into auth.users (email) values ('seeded-demo@x.test') returning id")).rows[0].id as string;
    await db.query("insert into public.memberships (user_id, organization_id, role) values ($1, $2, 'org_admin')", [user, demo]);

    await db.query("select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.sub', $2, false)", [JSON.stringify({ sub: user }), user]);
    await db.query("set role authenticated");
    try {
      expect(await count("select count(*)::int n from public.animals")).toBe(14);
      expect(await count("select count(*)::int n from public.animals a join public.organizations o on o.id = a.organization_id where o.slug = 'bank-of-punjab'")).toBe(0);
      expect(await count("select count(*)::int n from public.alerts")).toBe(0);
    } finally {
      await db.query("reset role");
    }
  });
});
