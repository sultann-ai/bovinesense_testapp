/**
 * Geofence creation and editing (supabase/migrations/20261009000009_geofence_editing.sql): what the
 * map's drawing tools are allowed to save, and who may save it.
 *
 * Geometry runs through stand-ins on PGlite (tests/db/backend.ts): shapes are opaque text, and a
 * shape containing INVALID, LINESTRING or NPOINTS=n triggers the matching validation, so every
 * rule is exercised. The authorisation rules are the real policies.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDb, type Query, type TestDb } from "./backend";
import { seedFixtures, type Fixtures } from "./fixtures";

let db: TestDb;
let fx: Fixtures;

beforeAll(async () => {
  db = await createTestDb();
  await db.query("begin");
  fx = await seedFixtures(db.query);
  await db.query(
    "insert into public.district_boundaries (district_name, province, gadm_gid, geom) values ('Lahore', 'Punjab', 'G-LHR', 'BOX(74.0 31.0,74.6 31.8)')",
  );
});
afterAll(async () => {
  await db.query("rollback");
  await db.close();
});

const SQUARE = JSON.stringify({ type: "Polygon", coordinates: [[[74, 31], [74.1, 31], [74.1, 31.1], [74, 31], [74, 31]]] });
const OTHER_SQUARE = JSON.stringify({ type: "Polygon", coordinates: [[[75, 32], [75.2, 32], [75.2, 32.2], [75, 32], [75, 32]]] });

interface Attempt { ok: boolean; code?: string; message?: string; rows: Array<Record<string, unknown>> }

/** Runs one statement inside a savepoint and reports what happened (never aborts the transaction). */
async function attempt(q: Query, sql: string, params: unknown[] = []): Promise<Attempt> {
  await q("savepoint a");
  try {
    const r = await q(sql, params);
    return { ok: true, rows: r.rows };
  } catch (err) {
    return { ok: false, code: (err as { code?: string }).code, message: (err as Error).message, rows: [] };
  } finally {
    await q("rollback to savepoint a");
    await q("release savepoint a");
  }
}

/** Like `attempt` but keeps the change, for building up state. */
async function create(q: Query, orgId: string, type: string, extra: Record<string, unknown> = {}) {
  const r = await q(
    "select public.create_geofence($1::uuid, $2, $3::public.fence_type, $4::int, $5, $6::jsonb, $7::float8, $8::float8, $9::float8) as id",
    [orgId, extra.name ?? "Zone", type, extra.buffer ?? 500, extra.district ?? null, extra.geojson ?? null, extra.lat ?? null, extra.lon ?? null, extra.radius ?? null],
  );
  return Number(r.rows[0].id);
}
const fence = async (id: number) => (await db.query("select * from public.geofences where id = $1", [id])).rows[0];

const as = (user: keyof Fixtures["users"], fn: (q: Query) => Promise<void>) => asUser(db, fx.users[user], fn);

describe("create_geofence: what may be saved", () => {
  it("saves a polygon, a radius with its centre and radius, and a district", async () => {
    await as("bopAdmin", async (q) => {
      const poly = await fence(await create(q, fx.bop.id, "polygon", { geojson: SQUARE }));
      expect(poly).toMatchObject({ type: "polygon", organization_id: fx.bop.id, center_lat: null, radius_m: null });

      const radius = await fence(await create(q, fx.bop.id, "radius", { lat: 31.52, lon: 74.36, radius: 2000 }));
      expect(radius).toMatchObject({ type: "radius", center_lat: 31.52, center_lon: 74.36, radius_m: 2000 });

      const district = await fence(await create(q, fx.bop.id, "district", { district: "Lahore" }));
      expect(district).toMatchObject({ type: "district", district_name: "Lahore", radius_m: null });
    });
  });

  it("trims the name and requires one", async () => {
    await as("bopAdmin", async (q) => {
      expect((await fence(await create(q, fx.bop.id, "polygon", { geojson: SQUARE, name: "  Barn  " }))).name).toBe("Barn");
      const blank = await attempt(q, "select public.create_geofence($1::uuid, '   ', 'polygon', 500, null, $2::jsonb)", [fx.bop.id, SQUARE]);
      expect(blank).toMatchObject({ ok: false, code: "22023" });
    });
  });

  it("rejects an invalid polygon (edges cross), a wrong geometry type, and one with too many points", async () => {
    await as("bopAdmin", async (q) => {
      const call = (geojson: string) => attempt(q, "select public.create_geofence($1::uuid, 'Z', 'polygon', 500, null, $2::jsonb)", [fx.bop.id, geojson]);
      const crossing = await call(JSON.stringify({ type: "Polygon", note: "INVALID" }));
      expect(crossing.code).toBe("22023");
      expect(crossing.message).toMatch(/cross/);
      expect((await call(JSON.stringify({ type: "LINESTRING" }))).code).toBe("22023");
      const big = await call(JSON.stringify({ type: "Polygon", note: "NPOINTS=2001" }));
      expect(big.code).toBe("22023");
      expect(big.message).toMatch(/too many points/);
      expect((await call(JSON.stringify({ type: "Polygon", note: "NPOINTS=2000" }))).ok).toBe(true);
    });
  });

  it("rejects a radius outside 50 m to 100 km, and a centre that is not a coordinate", async () => {
    await as("bopAdmin", async (q) => {
      const call = (lat: number, lon: number, r: number) =>
        attempt(q, "select public.create_geofence($1::uuid, 'Z', 'radius', 500, null, null, $2::float8, $3::float8, $4::float8)", [fx.bop.id, lat, lon, r]);
      expect((await call(31.5, 74.3, 49)).code).toBe("22023");
      expect((await call(31.5, 74.3, 100001)).code).toBe("22023");
      expect((await call(91, 74.3, 1000)).code).toBe("22023");
      expect((await call(31.5, 181, 1000)).code).toBe("22023");
      expect((await call(31.5, 74.3, 50)).ok).toBe(true);
      expect((await call(31.5, 74.3, 100000)).ok).toBe(true);
      const missing = await attempt(q, "select public.create_geofence($1::uuid, 'Z', 'radius', 500, null, null, 31.5, 74.3, null)", [fx.bop.id]);
      expect(missing.code).toBe("22023");
    });
  });

  it("rejects a warning buffer outside 50 m to 5 km, and an unknown district", async () => {
    await as("bopAdmin", async (q) => {
      for (const buffer of [49, 5001, -1]) {
        const r = await attempt(q, "select public.create_geofence($1::uuid, 'Z', 'polygon', $2::int, null, $3::jsonb)", [fx.bop.id, buffer, SQUARE]);
        expect(r.code, String(buffer)).toBe("22023");
      }
      const d = await attempt(q, "select public.create_geofence($1::uuid, 'Z', 'district', 500, 'Atlantis')", [fx.bop.id]);
      expect(d.code).toBe("P0002");
    });
  });

  it("only an organization admin can create one, and only in their own organization", async () => {
    for (const u of ["bopOfficer", "bopRegional", "bopAuditor"] as const) {
      await as(u, async (q) => {
        const r = await attempt(q, "select public.create_geofence($1::uuid, 'Z', 'polygon', 500, null, $2::jsonb)", [fx.bop.id, SQUARE]);
        expect(r, u).toMatchObject({ ok: false, code: "42501" });
      });
    }
    await as("demoAdmin", async (q) => {
      const r = await attempt(q, "select public.create_geofence($1::uuid, 'Z', 'polygon', 500, null, $2::jsonb)", [fx.bop.id, SQUARE]);
      expect(r).toMatchObject({ ok: false, code: "42501" });
    });
  });
});

describe("update_geofence", () => {
  let polygonId: number;
  let radiusId: number;
  let districtId: number;

  beforeAll(async () => {
    await as("bopAdmin", async (q) => {
      polygonId = await create(q, fx.bop.id, "polygon", { geojson: SQUARE, name: "Paddock", buffer: 500 });
      radiusId = await create(q, fx.bop.id, "radius", { lat: 31.5, lon: 74.3, radius: 1000, name: "Farm" });
      districtId = await create(q, fx.bop.id, "district", { district: "Lahore", name: "Lahore District" });
    });
  });

  const update = (q: Query, id: number, args: Record<string, unknown>) =>
    attempt(
      q,
      "select public.update_geofence($1::int, $2, $3::int, $4::jsonb, $5::float8, $6::float8, $7::float8) as id",
      [id, args.name ?? null, args.buffer ?? null, args.geojson ?? null, args.lat ?? null, args.lon ?? null, args.radius ?? null],
    );
  const updateKeep = async (q: Query, id: number, args: Record<string, unknown>) => {
    await q("select public.update_geofence($1::int, $2, $3::int, $4::jsonb, $5::float8, $6::float8, $7::float8)", [
      id, args.name ?? null, args.buffer ?? null, args.geojson ?? null, args.lat ?? null, args.lon ?? null, args.radius ?? null,
    ]);
  };

  it("renames a fence and changes its buffer without touching its shape", async () => {
    await as("bopAdmin", async (q) => {
      const before = await fence(polygonId);
      await updateKeep(q, polygonId, { name: "  Paddock 2 ", buffer: 750 });
      const after = await fence(polygonId);
      expect(after).toMatchObject({ name: "Paddock 2", warning_buffer_m: 750 });
      expect(after.geom).toEqual(before.geom);
    });
  });

  it("replaces a polygon's shape", async () => {
    await as("bopAdmin", async (q) => {
      await updateKeep(q, polygonId, { geojson: OTHER_SQUARE });
      expect(String((await fence(polygonId)).geom)).toContain("75");
    });
  });

  it("moves and resizes a radius fence, keeping centre and radius together", async () => {
    await as("bopAdmin", async (q) => {
      await updateKeep(q, radiusId, { lat: 30.1, lon: 71.5, radius: 3500 });
      expect(await fence(radiusId)).toMatchObject({ center_lat: 30.1, center_lon: 71.5, radius_m: 3500 });
      const partial = await update(q, radiusId, { lat: 30 });
      expect(partial.code).toBe("22023"); // centre and radius travel together
    });
  });

  it("applies the same validation as creating", async () => {
    await as("bopAdmin", async (q) => {
      expect((await update(q, polygonId, { geojson: JSON.stringify({ note: "INVALID" }) })).code).toBe("22023");
      expect((await update(q, radiusId, { lat: 31, lon: 74, radius: 10 })).code).toBe("22023");
      expect((await update(q, polygonId, { buffer: 10 })).code).toBe("22023");
      expect((await update(q, polygonId, { name: "   " })).code).toBe("22023");
    });
  });

  it("a district fence can be renamed and re-buffered but never reshaped", async () => {
    await as("bopAdmin", async (q) => {
      await updateKeep(q, districtId, { name: "Lahore (main)", buffer: 800 });
      expect(await fence(districtId)).toMatchObject({ name: "Lahore (main)", warning_buffer_m: 800 });
      const reshape = await update(q, districtId, { geojson: SQUARE });
      expect(reshape.code).toBe("22023");
      expect(reshape.message).toMatch(/district boundary/);
    });
  });

  it("is refused for everyone but an organization admin, and leaves the fence untouched", async () => {
    const before = await fence(polygonId);
    for (const u of ["bopOfficer", "bopRegional", "bopAuditor"] as const) {
      await as(u, async (q) => {
        const r = await update(q, polygonId, { name: "Hacked", buffer: 60 });
        expect(r, u).toMatchObject({ ok: false, code: "42501" });
      });
    }
    expect(await fence(polygonId)).toEqual(before);
  });

  it("another organization's fence looks like it does not exist", async () => {
    const before = await fence(polygonId);
    await as("demoAdmin", async (q) => {
      expect(await update(q, polygonId, { name: "Hacked" })).toMatchObject({ ok: false, code: "P0002" });
    });
    expect(await fence(polygonId)).toEqual(before);
  });

  it("an unknown id is not found", async () => {
    await as("bopAdmin", async (q) => {
      expect((await update(q, 999999, { name: "x" })).code).toBe("P0002");
    });
  });

  it("a platform admin (read-only) cannot change a fence", async () => {
    await as("platform", async (q) => {
      expect(await update(q, polygonId, { name: "x" })).toMatchObject({ ok: false, code: "42501" });
    });
  });

  it("geofence_detail exposes the centre and radius for the editor", async () => {
    await as("bopAuditor", async (q) => {
      const r = (await q("select center_lat, center_lon, radius_m, geojson from public.geofence_detail where id = $1", [radiusId])).rows[0];
      expect(r).toMatchObject({ center_lat: 30.1, center_lon: 71.5, radius_m: 3500 });
      expect(r.geojson).toBeTruthy();
    });
  });

  it("the helper functions are not callable anonymously", async () => {
    for (const sig of [
      "public.update_geofence(integer, text, integer, jsonb, double precision, double precision, double precision)",
      "public.build_fence_geometry(public.fence_type, text, jsonb, double precision, double precision, double precision)",
    ]) {
      const r = (await db.query("select has_function_privilege('anon', $1::regprocedure, 'execute') as a, has_function_privilege('authenticated', $1::regprocedure, 'execute') as u", [sig])).rows[0];
      expect(r, sig).toEqual({ a: false, u: true });
    }
  });
});
