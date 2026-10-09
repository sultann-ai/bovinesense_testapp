import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await sql`
      SELECT district_name,
             province,
             ST_AsGeoJSON(geom)::json AS geometry
      FROM   district_boundaries
      WHERE  province = 'Punjab'
    `;

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

    return NextResponse.json(geojson, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  } catch (err) {
    console.error("[api/boundaries]", err);
    return NextResponse.json(
      { type: "FeatureCollection", features: [] },
      { status: 503 },
    );
  }
}
