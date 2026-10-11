import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";
import { Constants } from "@/types/database";
import { enumParam, intParam } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { searchParams } = req.nextUrl;
  // Optional narrowing filters. They can only shrink the result: the caller's
  // organization / region / branch scope is always applied first.
  const regionId   = intParam(searchParams.get("region_id"));
  const branchId   = intParam(searchParams.get("branch_id"));
  const status     = enumParam(searchParams.get("status"), Constants.public.Enums.alert_status);
  const typeFilter = enumParam(searchParams.get("type"), Constants.public.Enums.alert_type);

  if (Number.isNaN(regionId) || Number.isNaN(branchId) || !status.ok || !typeFilter.ok) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  try {
    let query = ctx.db
      .from("alert_overview")
      .select(
        "id, type, severity, status, title, detail, distance_km, created_at, acknowledged_at, assigned_at, resolved_at, resolution_reason, animal_id, animal_name, animal_status, tag_serial, borrower_name, loan_number, branch_id, branch_name, region_id, region_name",
      )
      .match(scopeMatch(ctx))
      .neq("status", "resolved");

    if (regionId !== null)   query = query.eq("region_id", regionId);
    if (branchId !== null)   query = query.eq("branch_id", branchId);
    if (status.value)        query = query.eq("status", status.value);
    if (typeFilter.value)    query = query.eq("type", typeFilter.value);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/alerts/feed]", err);
    return NextResponse.json([], { status: 503 });
  }
}
