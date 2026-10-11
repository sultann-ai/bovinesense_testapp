/**
 * Route-level tests for PUT /api/geofences/:id and GET /api/geofences/features with a fake
 * authenticated context: input validation, how the database's error codes become HTTP statuses,
 * and the shape of the feature collection. (Who may edit, and what shapes are valid, is enforced in
 * Postgres and tested against the real SQL in tests/db/geofences.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const ORG = "11111111-1111-4111-8111-111111111111";

interface Fake {
  denied: NextResponse | null;
  rpcError: unknown;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  fenceRow: unknown;
  tables: Record<string, { data: unknown; error: unknown }>;
  eqCalls: Array<[string, unknown]>;
  permissionAsked: string | undefined;
}
const fake: Fake = { denied: null, rpcError: null, rpcCalls: [], fenceRow: null, tables: {}, eqCalls: [], permissionAsked: undefined };

vi.mock("@/lib/auth/api", () => ({
  scopeMatch: () => ({}),
  requireApiAccess: async (permission?: string) => {
    fake.permissionAsked = permission;
    if (fake.denied) return { ok: false, response: fake.denied };
    return {
      ok: true,
      ctx: {
        organizationId: ORG,
        scope: {},
        db: {
          rpc: async (name: string, args: Record<string, unknown>) => {
            fake.rpcCalls.push({ name, args });
            return { data: null, error: fake.rpcError };
          },
          from(table: string) {
            const result = () => (table === "geofences" ? { data: fake.fenceRow, error: null } : fake.tables[table] ?? { data: [], error: null });
            const chain: Record<string, unknown> = {
              select: () => chain,
              order: () => chain,
              eq: (col: string, val: unknown) => { fake.eqCalls.push([col, val]); return chain; },
              maybeSingle: async () => result(),
              then: (resolve: (v: unknown) => unknown) => resolve(result()),
            };
            return chain;
          },
        },
      },
    };
  },
}));

import { PUT } from "../src/app/api/geofences/[id]/route";
import { GET as FEATURES } from "../src/app/api/geofences/features/route";

const put = (id: string, body: unknown, raw = false) =>
  PUT(
    new NextRequest(`http://localhost/api/geofences/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  fake.denied = null;
  fake.rpcError = null;
  fake.rpcCalls = [];
  fake.fenceRow = { id: 5, name: "Farm", type: "radius", warning_buffer_m: 500, district_name: null, created_at: "2026-10-01T00:00:00Z", center_lat: 31.5, center_lon: 74.3, radius_m: 2000 };
  fake.tables = {};
  fake.eqCalls = [];
  fake.permissionAsked = undefined;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PUT /api/geofences/:id", () => {
  it("asks for the manage-geofences permission, and returns the auth refusal untouched", async () => {
    fake.denied = NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const res = await put("5", { name: "x" });
    expect(fake.permissionAsked).toBe("geofences:manage");
    expect(res.status).toBe(403);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("rejects an id that is not a number", async () => {
    expect((await put("abc", { name: "x" })).status).toBe(400);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("rejects a body that is not JSON", async () => {
    expect((await put("5", "{not json", true)).status).toBe(400);
    expect(fake.rpcCalls).toEqual([]);
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a buffer below 50 m", { warning_buffer_m: 10 }],
    ["a buffer above 5 km", { warning_buffer_m: 6000 }],
    ["a fractional buffer", { warning_buffer_m: 500.5 }],
    ["a radius below 50 m", { radius_m: 10 }],
    ["a radius above 100 km", { radius_m: 200_000 }],
    ["a latitude out of range", { center_lat: 91 }],
    ["a longitude out of range", { center_lon: -181 }],
    ["a text radius", { radius_m: "2000" }],
  ])("rejects %s without calling the database", async (_label, body) => {
    const res = await put("5", body);
    expect(res.status).toBe(400);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("passes only the fields sent to update_geofence and returns the saved fence", async () => {
    const res = await put("5", { center_lat: 31.6, center_lon: 74.4, radius_m: 2500 });
    expect(res.status).toBe(200);
    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0].name).toBe("update_geofence");
    expect(fake.rpcCalls[0].args).toMatchObject({ p_id: 5, p_center_lat: 31.6, p_center_lon: 74.4, p_radius_m: 2500 });
    expect(fake.rpcCalls[0].args.p_name).toBeUndefined();
    expect(fake.rpcCalls[0].args.p_geojson).toBeUndefined();
    expect((await res.json()).id).toBe(5);
    expect(fake.eqCalls).toContainEqual(["organization_id", ORG]); // app-side filter on top of RLS
  });

  it("passes a polygon through as geojson", async () => {
    const geojson = { type: "Polygon", coordinates: [[[74, 31], [74.1, 31], [74.1, 31.1], [74, 31]]] };
    expect((await put("5", { geojson })).status).toBe(200);
    expect(fake.rpcCalls[0].args.p_geojson).toEqual(geojson);
  });

  it.each([
    ["P0002", 404, "Not found"],
    ["42501", 403, "Forbidden"],
  ])("maps database error %s to HTTP %i", async (code, status, text) => {
    fake.rpcError = { code, message: "x" };
    const res = await put("5", { name: "x" });
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(text);
  });

  it("maps an invalid shape (22023) to 400 and shows the database's reason", async () => {
    fake.rpcError = { code: "22023", message: "The polygon crosses itself." };
    const res = await put("5", { geojson: { type: "Polygon", coordinates: [] } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("crosses itself");
  });

  it("answers 503 for any other database failure, without leaking its message", async () => {
    fake.rpcError = { code: "XX000", message: "connection refused to 10.0.0.1" };
    const res = await put("5", { name: "x" });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.1");
  });

  it("404 when the fence cannot be read back (another organization's, or gone)", async () => {
    fake.fenceRow = null;
    expect((await put("5", { name: "x" })).status).toBe(404);
  });
});

describe("GET /api/geofences/features", () => {
  const polygon = { type: "Polygon", coordinates: [[[74, 31], [74.1, 31], [74.1, 31.1], [74, 31]]] };

  it("is a FeatureCollection with what the map needs to style and edit each fence", async () => {
    fake.tables = {
      geofence_detail: {
        data: [
          { id: 1, name: "Lahore", type: "district", warning_buffer_m: 500, district_name: "Lahore", geojson: polygon, center_lat: null, center_lon: null, radius_m: null },
          { id: 2, name: "Farm", type: "radius", warning_buffer_m: 300, district_name: null, geojson: polygon, center_lat: 31.5, center_lon: 74.3, radius_m: 2000 },
        ],
        error: null,
      },
      geofence_overview: { data: [{ id: 1, animal_count: 12, breach_count: 2 }], error: null },
    };
    const res = await FEATURES();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(2);
    expect(body.features[0]).toMatchObject({ type: "Feature", id: 1, geometry: polygon, properties: { type: "district", animal_count: 12, breach_count: 2 } });
    // a fence with no row in the overview has no animals yet, not NaN or missing
    expect(body.features[1].properties).toMatchObject({ id: 2, type: "radius", center_lat: 31.5, center_lon: 74.3, radius_m: 2000, animal_count: 0, breach_count: 0 });
    expect(fake.eqCalls).toContainEqual(["organization_id", ORG]);
  });

  it("leaves out a fence that has no geometry", async () => {
    fake.tables = {
      geofence_detail: { data: [{ id: 3, name: "Broken", type: "polygon", warning_buffer_m: 500, district_name: null, geojson: null, center_lat: null, center_lon: null, radius_m: null }], error: null },
      geofence_overview: { data: [], error: null },
    };
    expect((await (await FEATURES()).json()).features).toEqual([]);
  });

  it("is empty, not an error, for an organization with no fences", async () => {
    const res = await FEATURES();
    expect(res.status).toBe(200);
    expect((await res.json()).features).toEqual([]);
  });

  it("answers 503 with an empty collection when the database fails", async () => {
    fake.tables = { geofence_detail: { data: null, error: { code: "XX000", message: "boom" } }, geofence_overview: { data: [], error: null } };
    const res = await FEATURES();
    expect(res.status).toBe(503);
    expect((await res.json()).features).toEqual([]);
  });

  it("returns the auth refusal untouched", async () => {
    fake.denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    expect((await FEATURES()).status).toBe(401);
  });
});
