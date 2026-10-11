/**
 * GET /api/geofences/features
 *
 * Every geofence of the active organization as a GeoJSON FeatureCollection, for drawing on the map:
 * the shape, plus what the map needs to style and edit it (type, buffer, open-breach count, and the
 * centre and radius of a radius fence). Row Level Security decides which fences the caller sees.
 */
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

export async function GET() {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  try {
    const [detail, overview] = await Promise.all([
      ctx.db
        .from("geofence_detail")
        .select("id, name, type, warning_buffer_m, district_name, geojson, center_lat, center_lon, radius_m")
        .eq("organization_id", ctx.organizationId)
        .order("id", { ascending: true }),
      ctx.db
        .from("geofence_overview")
        .select("id, animal_count, breach_count")
        .eq("organization_id", ctx.organizationId),
    ]);
    if (detail.error) throw detail.error;
    if (overview.error) throw overview.error;

    const counts = new Map(overview.data.map((r) => [r.id, r]));
    const features = detail.data
      .filter((f) => f.geojson !== null && f.id !== null)
      .map((f) => ({
        type: "Feature" as const,
        id: f.id as number,
        geometry: f.geojson,
        properties: {
          id: f.id,
          name: f.name,
          type: f.type,
          warning_buffer_m: f.warning_buffer_m,
          district_name: f.district_name,
          center_lat: f.center_lat,
          center_lon: f.center_lon,
          radius_m: f.radius_m,
          animal_count: counts.get(f.id as number)?.animal_count ?? 0,
          breach_count: counts.get(f.id as number)?.breach_count ?? 0,
        },
      }));

    return NextResponse.json({ type: "FeatureCollection", features }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[api/geofences/features]", err);
    return NextResponse.json(EMPTY, { status: 503 });
  }
}
