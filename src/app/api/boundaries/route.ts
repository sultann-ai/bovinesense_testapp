import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

export async function GET() {
  // District polygons are shared reference data (no organization_id), but still only
  // for signed-in users with an active organization.
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  try {
    const { data: rows, error } = await ctx.db
      .from("district_boundary_features")
      // Whatever has been imported (npm run import:boundaries); no region is hardcoded here.
      .select("district_name, province, geometry");
    if (error) throw error;

    const geojson = {
      type: "FeatureCollection" as const,
      features: rows.map((r) => ({
        type: "Feature" as const,
        properties: {
          district_name: r.district_name,
          province:      r.province,
        },
        geometry: r.geometry,
      })),
    };

    // private: the response is for a signed-in user, so shared caches must not keep it.
    return NextResponse.json(geojson, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    console.error("[api/boundaries]", err);
    return NextResponse.json(
      { type: "FeatureCollection", features: [] },
      { status: 503 },
    );
  }
}
