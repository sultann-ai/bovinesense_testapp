/**
 * GET /api/scope
 *
 * The regions and branches the signed-in user can pick from in the top-bar scope selector, with the
 * part of the hierarchy their membership already fixes. Names are tenant data. Row Level Security
 * decides which rows come back (a regional manager sees one region, a branch officer one branch).
 */
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  try {
    const [regions, branches] = await Promise.all([
      ctx.db.from("regions").select("id, name").eq("organization_id", ctx.organizationId).order("name"),
      ctx.db.from("branches").select("id, name, region_id").eq("organization_id", ctx.organizationId).order("name"),
    ]);
    if (regions.error) throw regions.error;
    if (branches.error) throw branches.error;

    return NextResponse.json(
      {
        regions: regions.data,
        branches: branches.data,
        // What the membership fixes: the selector shows it and cannot change it.
        locked: { regionId: ctx.scope.regionId, branchId: ctx.scope.branchId },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/scope]", err);
    return NextResponse.json({ error: "Could not load regions and branches." }, { status: 503 });
  }
}
