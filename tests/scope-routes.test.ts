/**
 * Route-level tests for the scope selector: GET /api/scope, and the region_id / branch_id narrowing
 * on /api/kpi, /api/animals and /api/alerts. The caller's own membership scope is applied by
 * scopeMatch first; the selector can only narrow further (it is applied as extra .eq filters).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const ORG = "11111111-1111-4111-8111-111111111111";

interface Fake {
  denied: NextResponse | null;
  scope: { regionId: number | null; branchId: number | null };
  tables: Record<string, { data: unknown; error: unknown }>;
  eq: Array<[string, string, unknown]>;
  matches: Array<Record<string, unknown>>;
}
const fake: Fake = { denied: null, scope: { regionId: null, branchId: null }, tables: {}, eq: [], matches: [] };

vi.mock("@/lib/auth/api", () => ({
  scopeMatch: (ctx: { organizationId: string; scope: { regionId: number | null; branchId: number | null } }) => ({
    organization_id: ctx.organizationId,
    ...(ctx.scope.branchId !== null ? { branch_id: ctx.scope.branchId } : ctx.scope.regionId !== null ? { region_id: ctx.scope.regionId } : {}),
  }),
  requireApiAccess: async () => {
    if (fake.denied) return { ok: false, response: fake.denied };
    return {
      ok: true,
      ctx: {
        organizationId: ORG,
        scope: fake.scope,
        db: {
          from(table: string) {
            const result = () => fake.tables[table] ?? { data: [], error: null };
            const chain: Record<string, unknown> = {
              select: () => chain,
              order: () => chain,
              range: () => chain,
              limit: () => chain,
              or: () => chain,
              not: () => chain,
              match: (m: Record<string, unknown>) => { fake.matches.push(m); return chain; },
              eq: (col: string, val: unknown) => { fake.eq.push([table, col, val]); return chain; },
              then: (resolve: (v: unknown) => unknown) => resolve(result()),
            };
            return chain;
          },
        },
      },
    };
  },
}));

import { GET as scopeGET } from "../src/app/api/scope/route";
import { GET as kpiGET } from "../src/app/api/kpi/route";
import { GET as animalsGET } from "../src/app/api/animals/route";
import { GET as alertsGET } from "../src/app/api/alerts/route";

const req = (path: string) => new NextRequest(`http://localhost${path}`);

beforeEach(() => {
  fake.denied = null;
  fake.scope = { regionId: null, branchId: null };
  fake.tables = {};
  fake.eq = [];
  fake.matches = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/scope", () => {
  it("returns the organization's regions and branches, and what the membership fixes", async () => {
    fake.scope = { regionId: 2, branchId: null };
    fake.tables = {
      regions: { data: [{ id: 2, name: "Coast" }], error: null },
      branches: { data: [{ id: 20, name: "Harbour", region_id: 2 }], error: null },
    };
    const res = await scopeGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      regions: [{ id: 2, name: "Coast" }],
      branches: [{ id: 20, name: "Harbour", region_id: 2 }],
      locked: { regionId: 2, branchId: null },
    });
    expect(fake.eq).toContainEqual(["regions", "organization_id", ORG]);
    expect(fake.eq).toContainEqual(["branches", "organization_id", ORG]);
  });

  it("returns the auth refusal untouched", async () => {
    fake.denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    expect((await scopeGET()).status).toBe(401);
  });

  it("answers 503 with a plain message when the database fails, without leaking its error", async () => {
    fake.tables = { regions: { data: null, error: { message: "connection refused 10.0.0.5" } }, branches: { data: [], error: null } };
    const res = await scopeGET();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.5");
  });
});

describe("the selector narrows /api/kpi, /api/animals and /api/alerts", () => {
  it("kpi: adds region and branch filters on top of the caller's own scope", async () => {
    fake.scope = { regionId: 1, branchId: null };
    fake.tables = { kpi_summary: { data: [{ total: 3, inside_count: 2, breach_count: 1, stale_count: 0, new_alerts: 1 }], error: null } };
    const res = await kpiGET(req("/api/kpi?region_id=1&branch_id=11"));
    expect(res.status).toBe(200);
    expect(fake.matches[0]).toMatchObject({ organization_id: ORG, region_id: 1 }); // membership first
    expect(fake.eq).toContainEqual(["kpi_summary", "region_id", 1]);
    expect(fake.eq).toContainEqual(["kpi_summary", "branch_id", 11]);
    expect((await res.json()).inside_pct).toBe(67);
  });

  it("kpi: no parameters means no extra filters", async () => {
    fake.tables = { kpi_summary: { data: [], error: null } };
    await kpiGET(req("/api/kpi"));
    // (the 24 h deltas read other tables; the summary itself gets no extra filter)
    expect(fake.eq.filter((e) => e[0] === "kpi_summary")).toEqual([]);
  });

  it("animals: filters by region and branch", async () => {
    await animalsGET(req("/api/animals?region_id=2&branch_id=20"));
    expect(fake.eq).toContainEqual(["animal_overview", "region_id", 2]);
    expect(fake.eq).toContainEqual(["animal_overview", "branch_id", 20]);
  });

  it("alerts: filters by region and branch", async () => {
    await alertsGET(req("/api/alerts?region_id=2&branch_id=20"));
    expect(fake.eq).toContainEqual(["alert_overview", "region_id", 2]);
    expect(fake.eq).toContainEqual(["alert_overview", "branch_id", 20]);
  });

  it.each([
    ["kpi", () => kpiGET(req("/api/kpi?region_id=abc"))],
    ["animals", () => animalsGET(req("/api/animals?branch_id=1.5"))],
    ["alerts", () => alertsGET(req("/api/alerts?region_id=x"))],
  ])("%s: a malformed scope is a 400, not an unfiltered answer", async (_name, call) => {
    expect((await call()).status).toBe(400);
  });
});
