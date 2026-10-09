import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const regionId = searchParams.get("region_id");
  const branchId = searchParams.get("branch_id");

  try {
    const rows = await sql`
      SELECT
        a.id,
        a.name        AS animal_name,
        a.status,
        t.serial_number                                 AS tag_serial,
        bo.name                                         AS borrower_name,
        l.loan_number,
        br.id                                           AS branch_id,
        br.name                                         AS branch_name,
        r.id                                            AS region_id,
        r.name                                          AS region_name,
        f.lat,
        f.lon,
        f.fixed_at,
        f.battery_pct,
        f.speed_kmh,
        EXISTS (
          SELECT 1 FROM alerts al
          WHERE  al.animal_id = a.id
            AND  al.type      = 'breach'
            AND  al.status    = 'new'
        ) AS has_unack_breach
      FROM   animals a
      LEFT JOIN tags      t   ON t.id   = a.tag_id
      LEFT JOIN borrowers bo  ON bo.id  = a.borrower_id
      LEFT JOIN loans     l   ON l.id   = a.loan_id
      JOIN      branches  br  ON br.id  = a.branch_id
      LEFT JOIN regions   r   ON r.id   = br.region_id
      LEFT JOIN LATERAL (
        SELECT lat, lon, fixed_at, battery_pct, speed_kmh
        FROM   fixes
        WHERE  animal_id = a.id
        ORDER  BY fixed_at DESC
        LIMIT  1
      ) f ON true
      WHERE  (${regionId}::int IS NULL OR r.id = ${regionId}::int)
        AND  (${branchId}::int IS NULL OR br.id = ${branchId}::int)
        AND  f.lat IS NOT NULL
    `;

    const geojson = {
      type: "FeatureCollection" as const,
      features: rows.map((r) => ({
        type: "Feature" as const,
        id: r.id,
        geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] },
        properties: {
          id:              r.id,
          animal_name:     r.animal_name,
          status:          r.status,
          tag_serial:      r.tag_serial,
          borrower_name:   r.borrower_name,
          loan_number:     r.loan_number,
          branch_id:       r.branch_id,
          branch_name:     r.branch_name,
          region_id:       r.region_id,
          fixed_at:        r.fixed_at,
          battery_pct:     r.battery_pct,
          speed_kmh:       r.speed_kmh,
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
