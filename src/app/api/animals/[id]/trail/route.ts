import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";
import { clampInt } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  const animalId = parseInt(id, 10);
  if (isNaN(animalId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // 1 h … 7 days, default 24 h
  const hours = clampInt(req.nextUrl.searchParams.get("hours"), 24, 1, 168);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  try {
    // The animal must be inside the caller's organization / region / branch.
    const { data: animal, error: animalError } = await ctx.db
      .from("animal_overview")
      .select("id")
      .match(scopeMatch(ctx))
      .eq("id", animalId)
      .maybeSingle();
    if (animalError) throw animalError;
    if (!animal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: fixes, error } = await ctx.db
      .from("fixes")
      .select("id, lat, lon, fixed_at, speed_kmh, battery_pct")
      .eq("organization_id", ctx.organizationId)
      .eq("animal_id", animalId)
      .gte("fixed_at", since)
      // Newest first so the 1000-row cap (Supabase's default max_rows) drops the
      // oldest points, not the latest ones; reversed again below.
      .order("fixed_at", { ascending: false })
      .limit(1000);
    if (error) throw error;

    const geojson = {
      type: "FeatureCollection" as const,
      features: [...fixes].reverse().map((f) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [f.lon, f.lat],
        },
        properties: {
          id:          f.id,
          fixed_at:    f.fixed_at,
          speed_kmh:   f.speed_kmh,
          battery_pct: f.battery_pct,
        },
      })),
    };

    return NextResponse.json(geojson);
  } catch (err) {
    console.error("[api/animals/trail]", err);
    return NextResponse.json({ type: "FeatureCollection", features: [] }, { status: 503 });
  }
}
