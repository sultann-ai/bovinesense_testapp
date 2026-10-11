/**
 * Route-level tests for assigning alerts and fences: GET /api/alerts/:id/assignees,
 * PATCH /api/alerts/:id/transition (assign) and POST /api/geofences/:id/animals, with a fake
 * authenticated context. Who may do what is enforced by Postgres and proven in tests/db; these check
 * validation, the permission asked for, and how database answers become HTTP statuses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const OFFICER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

const fake = {
  denied: null as NextResponse | null,
  permissionAsked: undefined as string | undefined,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcResult: {} as Record<string, { data: unknown; error: unknown }>,
  transitions: [] as unknown[],
  role: "branch_officer",
};

vi.mock("@/lib/auth/api", () => ({
  scopeMatch: () => ({}),
  requireApiAccess: async (permission?: string) => {
    fake.permissionAsked = permission;
    if (fake.denied) return { ok: false, response: fake.denied };
    return {
      ok: true,
      ctx: {
        organizationId: "11111111-1111-4111-8111-111111111111",
        role: fake.role,
        user: { id: "99999999-9999-4999-8999-999999999999" },
        scope: {},
        db: {
          rpc: async (name: string, args: Record<string, unknown>) => {
            fake.rpcCalls.push({ name, args });
            return fake.rpcResult[name] ?? { data: null, error: null };
          },
        },
      },
    };
  },
}));
vi.mock("@/lib/alerts/alert-lifecycle", () => ({
  AlertTransitionError: class extends Error {},
  transitionAlert: async (...args: unknown[]) => { fake.transitions.push(args); },
}));

import { GET as ASSIGNEES } from "../src/app/api/alerts/[id]/assignees/route";
import { PATCH as TRANSITION } from "../src/app/api/alerts/[id]/transition/route";
import { POST as FENCE_ANIMALS } from "../src/app/api/geofences/[id]/animals/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  fake.denied = null;
  fake.permissionAsked = undefined;
  fake.rpcCalls = [];
  fake.rpcResult = { alert_assignees: { data: [{ user_id: OFFICER, full_name: "Amina Khan" }], error: null } };
  fake.transitions = [];
});

describe("GET /api/alerts/:id/assignees", () => {
  it("asks for the assign permission and returns the branch officers", async () => {
    const res = await ASSIGNEES(new NextRequest("http://localhost/api/alerts/7/assignees"), ctx("7"));
    expect(fake.permissionAsked).toBe("alerts:assign");
    expect(await res.json()).toEqual([{ user_id: OFFICER, full_name: "Amina Khan" }]);
    expect(fake.rpcCalls[0]).toEqual({ name: "alert_assignees", args: { p_alert_id: 7 } });
  });

  it("is refused for a role without the permission", async () => {
    fake.denied = NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const res = await ASSIGNEES(new NextRequest("http://localhost/api/alerts/7/assignees"), ctx("7"));
    expect(res.status).toBe(403);
  });

  it("rejects a non-numeric id", async () => {
    const res = await ASSIGNEES(new NextRequest("http://localhost/api/alerts/x/assignees"), ctx("x"));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/alerts/:id/transition to assigned", () => {
  const url = "http://localhost/api/alerts/7/transition";

  it("assigns to an officer of the branch and records who was chosen in the audit note", async () => {
    const res = await TRANSITION(json(url, "PATCH", { to_status: "assigned", assignee_id: OFFICER }), ctx("7"));
    expect(res.status).toBe(200);
    const opts = fake.transitions[0] as unknown[];
    expect(opts[4]).toMatchObject({ assigneeId: OFFICER, note: "Assigned to Amina Khan", userId: "99999999-9999-4999-8999-999999999999" });
  });

  it("refuses an assignee who is not an officer of that branch", async () => {
    const res = await TRANSITION(json(url, "PATCH", { to_status: "assigned", assignee_id: STRANGER }), ctx("7"));
    expect(res.status).toBe(422);
    expect(fake.transitions).toHaveLength(0);
  });

  it("requires an assignee", async () => {
    const res = await TRANSITION(json(url, "PATCH", { to_status: "assigned" }), ctx("7"));
    expect(res.status).toBe(422);
  });

  it("resolving puts the reason and note into the audit row", async () => {
    await TRANSITION(json(url, "PATCH", { to_status: "resolved", resolution_reason: "false_alarm", resolution_note: "Cow was at the vet" }), ctx("7"));
    const opts = fake.transitions[0] as unknown[];
    expect(opts[4]).toMatchObject({ resolutionReason: "false_alarm", note: "Reason: false alarm — Cow was at the vet" });
  });
});

describe("POST /api/geofences/:id/animals", () => {
  const url = "http://localhost/api/geofences/3/animals";

  it("needs the geofence-management permission", async () => {
    await FENCE_ANIMALS(json(url, "POST", { animal_ids: [1], action: "assign" }), ctx("3"));
    expect(fake.permissionAsked).toBe("geofences:manage");
  });

  it("assigns through the database function and reports how many changed", async () => {
    fake.rpcResult.set_animal_fence = { data: 2, error: null };
    const res = await FENCE_ANIMALS(json(url, "POST", { animal_ids: [1, 2], action: "assign" }), ctx("3"));
    expect(await res.json()).toEqual({ changed: 2 });
    expect(fake.rpcCalls[0]).toEqual({ name: "set_animal_fence", args: { p_geofence_id: 3, p_animal_ids: [1, 2], p_assign: true } });
  });

  it("unassigns", async () => {
    await FENCE_ANIMALS(json(url, "POST", { animal_ids: [1], action: "unassign" }), ctx("3"));
    expect(fake.rpcCalls[0].args.p_assign).toBe(false);
  });

  it("validates the body", async () => {
    expect((await FENCE_ANIMALS(json(url, "POST", { animal_ids: [], action: "assign" }), ctx("3"))).status).toBe(400);
    expect((await FENCE_ANIMALS(json(url, "POST", { animal_ids: [1], action: "nope" }), ctx("3"))).status).toBe(400);
  });

  it("maps database errors to statuses", async () => {
    fake.rpcResult.set_animal_fence = { data: null, error: { code: "P0002", message: "geofence 3 not found" } };
    expect((await FENCE_ANIMALS(json(url, "POST", { animal_ids: [1], action: "assign" }), ctx("3"))).status).toBe(404);
    fake.rpcResult.set_animal_fence = { data: null, error: { code: "42501", message: "denied" } };
    expect((await FENCE_ANIMALS(json(url, "POST", { animal_ids: [1], action: "assign" }), ctx("3"))).status).toBe(403);
  });
});
