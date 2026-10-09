import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const fenceId = parseInt(id, 10);
  if (isNaN(fenceId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const [fence] = await sql`
      SELECT g.*, ST_AsGeoJSON(g.geom) AS geojson
      FROM   geofences g
      WHERE  g.id = ${fenceId}
    `;
    if (!fence) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const animals = await sql`
      SELECT a.id, a.name, a.status, t.serial_number AS tag_serial
      FROM   animal_geofence ag
      JOIN   animals a ON a.id = ag.animal_id
      LEFT JOIN tags t ON t.id = a.tag_id
      WHERE  ag.geofence_id = ${fenceId} AND ag.is_active
    `;

    return NextResponse.json({ ...fence, animals });
  } catch (err) {
    console.error("[api/geofences/[id] GET]", err);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const fenceId = parseInt(id, 10);
  if (isNaN(fenceId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const { name, warning_buffer_m } = await req.json();
    const [fence] = await sql`
      UPDATE geofences
      SET    name             = COALESCE(${name ?? null}, name),
             warning_buffer_m = COALESCE(${warning_buffer_m ?? null}, warning_buffer_m)
      WHERE  id = ${fenceId}
      RETURNING id, name, type, warning_buffer_m, district_name, created_at
    `;
    if (!fence) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(fence);
  } catch (err) {
    console.error("[api/geofences/[id] PUT]", err);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const fenceId = parseInt(id, 10);
  if (isNaN(fenceId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    await sql`DELETE FROM animal_geofence WHERE geofence_id = ${fenceId}`;
    await sql`DELETE FROM geofences        WHERE id         = ${fenceId}`;
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[api/geofences/[id] DELETE]", err);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
}
