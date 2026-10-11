import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";
import { intParam } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { searchParams } = req.nextUrl;
  // Optional narrowing filters; the caller's scope is always applied first.
  const regionId = intParam(searchParams.get("region_id"));
  const branchId = intParam(searchParams.get("branch_id"));

  if (Number.isNaN(regionId) || Number.isNaN(branchId)) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  try {
    let query = ctx.db
      .from("animal_overview")
      .select(
        "id, animal_name, status, tag_serial, borrower_name, loan_number, branch_id, branch_name, region_id, lat, lon, last_fix_at, battery_pct, speed_kmh, has_unack_breach",
      )
      .match(scopeMatch(ctx))
      .not("lat", "is", null);

    if (regionId !== null) query = query.eq("region_id", regionId);
    if (branchId !== null) query = query.eq("branch_id", branchId);

    // Supabase caps a single response at max_rows (default 1000). Fleets larger than
    // that need paging or server-side clustering — see README "Limits".
    const { data, error } = await query.limit(1000);
    if (error) throw error;

    const geojson = {
      type: "FeatureCollection" as const,
      features: data.map((r) => ({
        type: "Feature" as const,
        id: r.id,
        geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] },
        properties: {
          id:               r.id,
          animal_name:      r.animal_name,
          status:           r.status,
          tag_serial:       r.tag_serial,
          borrower_name:    r.borrower_name,
          loan_number:      r.loan_number,
          branch_id:        r.branch_id,
          branch_name:      r.branch_name,
          region_id:        r.region_id,
          fixed_at:         r.last_fix_at,
          battery_pct:      r.battery_pct,
          speed_kmh:        r.speed_kmh,
          has_unack_breach: r.has_unack_breach,
        },
      })),
    };

    return NextResponse.json(geojson);
  } catch (err) {
    console.error("[api/animals/markers]", err);
    return NextResponse.json(
      { type: "FeatureCollection", features: [] },
      { status: 503 },
    );
  }
}
