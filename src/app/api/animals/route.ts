import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";
import { Constants } from "@/types/database";
import { clampInt, enumParam, ilikeAny, intParam } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const sp     = req.nextUrl.searchParams;
  const q      = sp.get("q")?.trim() || null;
  const status = enumParam(sp.get("status"), Constants.public.Enums.animal_status);
  const regionId = intParam(sp.get("region_id"));
  const branchId = intParam(sp.get("branch_id"));
  const limit  = clampInt(sp.get("limit"), 100, 1, 200);
  const offset = clampInt(sp.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  if (!status.ok || Number.isNaN(regionId) || Number.isNaN(branchId)) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  try {
    let query = ctx.db
      .from("animal_overview")
      .select(
        "id, animal_name, species, status, tag_serial, borrower_name, loan_number, branch_name, district, last_fix_at, battery_pct, lat, lon, geofence_id, geofence_name",
      )
      .match(scopeMatch(ctx));

    if (q)            query = query.or(ilikeAny(["tag_serial", "borrower_name", "loan_number", "animal_name"], q));
    if (status.value) query = query.eq("status", status.value);
    // The scope selector narrows further; the caller's own scope was applied above.
    if (regionId !== null) query = query.eq("region_id", regionId);
    if (branchId !== null) query = query.eq("branch_id", branchId);

    const { data, error } = await query
      .order("status_rank", { ascending: true })
      .order("last_fix_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    // The table component reads `name` for the animal's name.
    return NextResponse.json(
      data.map(({ animal_name, ...rest }) => ({ name: animal_name, ...rest })),
    );
  } catch (err) {
    console.error("[api/animals]", err);
    return NextResponse.json([], { status: 503 });
  }
}
