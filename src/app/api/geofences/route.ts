import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await sql`
      SELECT
        g.id, g.name, g.type, g.warning_buffer_m, g.district_name,
        g.created_at,
        COUNT(DISTINCT ag.animal_id) FILTER (WHERE ag.is_active)      AS animal_count,
        COUNT(DISTINCT al.id)        FILTER (WHERE al.status = 'new' AND al.type = 'breach') AS breach_count
      FROM   geofences g
      LEFT JOIN animal_geofence ag ON ag.geofence_id = g.id
      LEFT JOIN animals a          ON a.id = ag.animal_id AND ag.is_active
      LEFT JOIN alerts  al         ON al.animal_id = a.id AND al.status != 'resolved'
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `;

    return NextResponse.json(rows);
  } catch (err) {
    console.error("[api/geofences GET]", err);
    return NextResponse.json([], { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, type, warning_buffer_m = 500, district_name, geojson, radius_m, center_lat, center_lon } = body;

    if (!name || !type) {
      return NextResponse.json({ error: "name and type required" }, { status: 400 });
    }

    let geomExpr: string;

    if (type === "district") {
      // Copy boundary geometry from district_boundaries
      const [row] = await sql`
        SELECT ST_AsGeoJSON(geom) AS gj
        FROM   district_boundaries
        WHERE  district_name = ${district_name}
        LIMIT  1
      `;
      if (!row) return NextResponse.json({ error: "District not found" }, { status: 404 });
      geomExpr = row.gj;
    } else if (type === "polygon") {
      if (!geojson) return NextResponse.json({ error: "geojson required for polygon type" }, { status: 400 });
      geomExpr = typeof geojson === "string" ? geojson : JSON.stringify(geojson);
    } else if (type === "radius") {
      if (!center_lat || !center_lon || !radius_m) {
        return NextResponse.json({ error: "center_lat, center_lon, radius_m required for radius type" }, { status: 400 });
      }
      // Create circular polygon via buffer on geography
      const [row] = await sql`
        SELECT ST_AsGeoJSON(
          ST_Buffer(ST_MakePoint(${center_lon}::float8, ${center_lat}::float8)::geography, ${radius_m}::float8)::geometry
        ) AS gj
      `;
      geomExpr = row.gj;
    } else {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const [fence] = await sql`
      INSERT INTO geofences (name, type, geom, warning_buffer_m, district_name)
      VALUES (
        ${name},
        ${type}::fence_type,
        ST_GeomFromGeoJSON(${geomExpr}),
        ${warning_buffer_m},
        ${district_name ?? null}
      )
      RETURNING id, name, type, warning_buffer_m, district_name, created_at
    `;

    return NextResponse.json(fence, { status: 201 });
  } catch (err) {
    console.error("[api/geofences POST]", err);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
}
