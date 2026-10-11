import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api";
import { Constants } from "@/types/database";
import { errorCode } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  try {
    const { data, error } = await ctx.db
      .from("geofence_overview")
      .select("id, name, type, warning_buffer_m, district_name, created_at, animal_count, breach_count")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/geofences GET]", err);
    return NextResponse.json([], { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  // Only organization admins change geofences.
  const auth = await requireApiAccess("geofences:manage");
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // The organization always comes from the session. An `organization_id` in the body
  // is ignored: a caller cannot create fences for someone else's tenant.
  const {
    name, type, district_name, geojson, radius_m, center_lat, center_lon,
  } = body as {
    name?: string; type?: string; district_name?: string | null;
    geojson?: unknown; radius_m?: number; center_lat?: number; center_lon?: number;
  };
  const warning_buffer_m = typeof body.warning_buffer_m === "number" ? body.warning_buffer_m : 500;

  if (!name || !type) {
    return NextResponse.json({ error: "name and type required" }, { status: 400 });
  }
  if (!(Constants.public.Enums.fence_type as readonly string[]).includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  const fenceType = type as (typeof Constants.public.Enums.fence_type)[number];

  try {
    // Geometry building (district copy / GeoJSON / radius buffer) happens in Postgres.
    const { data: newId, error } = await ctx.db.rpc("create_geofence", {
      p_organization_id:  ctx.organizationId,
      p_name:             name,
      p_type:             fenceType,
      p_warning_buffer_m: warning_buffer_m,
      p_district_name:    district_name ?? undefined,
      p_geojson:          geojson === undefined || geojson === null
        ? undefined
        : typeof geojson === "string" ? JSON.parse(geojson) : (geojson as never),
      p_center_lat:       center_lat,
      p_center_lon:       center_lon,
      p_radius_m:         radius_m,
    });
    if (error) throw error;

    const { data: fence, error: fenceError } = await ctx.db
      .from("geofences")
      .select("id, name, type, warning_buffer_m, district_name, created_at")
      .eq("organization_id", ctx.organizationId)
      .eq("id", newId)
      .single();
    if (fenceError) throw fenceError;

    return NextResponse.json(fence, { status: 201 });
  } catch (err) {
    const code = errorCode(err);
    if (code === "P0002") return NextResponse.json({ error: "District not found" }, { status: 404 });
    // The database refused (row level security): the caller is not an admin of this organization.
    if (code === "42501") return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    if (code === "22023") {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : (err as { message: string }).message },
        { status: 400 },
      );
    }
    console.error("[api/geofences POST]", err);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
}
