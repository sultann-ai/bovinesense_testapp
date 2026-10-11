import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";
import { errorCode, errorMessage } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  const fenceId = parseInt(id, 10);
  if (isNaN(fenceId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const { data: fence, error } = await ctx.db
      .from("geofence_detail")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("id", fenceId)
      .maybeSingle();
    if (error) throw error;
    if (!fence) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Only the animals this caller may see (their region / branch, if scoped).
    const { data: animals, error: animalsError } = await ctx.db
      .from("animal_overview")
      .select("id, animal_name, status, tag_serial")
      .match(scopeMatch(ctx))
      .eq("geofence_id", fenceId);
    if (animalsError) throw animalsError;

    return NextResponse.json({
      ...fence,
      animals: animals.map(({ animal_name, ...rest }) => ({ name: animal_name, ...rest })),
    });
  } catch (err) {
    console.error("[api/geofences/[id] GET]", err);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
}

// What the map's editor may send. Every field is optional; only the ones given change. The database
// validates the shape (a polygon that crosses itself, a radius out of range, ...) and answers 22023.
const UpdateSchema = z.object({
  name:             z.string().trim().min(1).max(150).optional(),
  warning_buffer_m: z.number().int().min(50).max(5000).optional(),
  geojson:          z.record(z.string(), z.unknown()).optional(),
  center_lat:       z.number().min(-90).max(90).optional(),
  center_lon:       z.number().min(-180).max(180).optional(),
  radius_m:         z.number().min(50).max(100_000).optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAccess("geofences:manage");
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  const fenceId = parseInt(id, 10);
  if (isNaN(fenceId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const u = parsed.data;

  try {
    // One database function applies the change and checks the shape. It runs as the signed-in user,
    // so Row Level Security decides who may edit: only organization admins.
    const { error: rpcError } = await ctx.db.rpc("update_geofence", {
      p_id:               fenceId,
      p_name:             u.name,
      p_warning_buffer_m: u.warning_buffer_m,
      p_geojson:          u.geojson as never,
      p_center_lat:       u.center_lat,
      p_center_lon:       u.center_lon,
      p_radius_m:         u.radius_m,
    });
    if (rpcError) throw rpcError;

    const { data: fence, error } = await ctx.db
      .from("geofences")
      .select("id, name, type, warning_buffer_m, district_name, created_at, center_lat, center_lon, radius_m")
      .eq("organization_id", ctx.organizationId)
      .eq("id", fenceId)
      .maybeSingle();
    if (error) throw error;
    if (!fence) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(fence);
  } catch (err) {
    const code = errorCode(err);
    if (code === "P0002") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (code === "42501") return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
    if (code === "22023") return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
    console.error("[api/geofences/[id] PUT]", err);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAccess("geofences:manage");
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  const fenceId = parseInt(id, 10);
  if (isNaN(fenceId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    // Make sure the fence belongs to this organization before touching anything.
    const { data: existing, error: lookupError } = await ctx.db
      .from("geofences")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", fenceId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { error: linkError } = await ctx.db
      .from("animal_geofence")
      .delete()
      .eq("organization_id", ctx.organizationId)
      .eq("geofence_id", fenceId);
    if (linkError) throw linkError;

    // A refused DELETE matches no rows rather than failing, so confirm the fence is really gone.
    const { data: removed, error } = await ctx.db
      .from("geofences")
      .delete()
      .eq("organization_id", ctx.organizationId)
      .eq("id", fenceId)
      .select("id");
    if (error) throw error;
    if (removed.length === 0) return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[api/geofences/[id] DELETE]", err);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
}
