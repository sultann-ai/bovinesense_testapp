import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const animalId = parseInt(id, 10);
  if (isNaN(animalId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const hours = Math.min(
    parseInt(req.nextUrl.searchParams.get("hours") ?? "24", 10),
    168, // max 7 days
  );

  try {
    const fixes = await sql`
      SELECT id, lat, lon, fixed_at, speed_kmh, battery_pct
      FROM   fixes
      WHERE  animal_id  = ${animalId}
        AND  fixed_at  >= NOW() - make_interval(hours => ${hours})
      ORDER  BY fixed_at ASC
      LIMIT  2000
    `;

    const geojson = {
      type: "FeatureCollection" as const,
      features: fixes.map((f) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [f.lon as number, f.lat as number],
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
