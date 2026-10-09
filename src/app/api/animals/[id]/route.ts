import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const animalId = parseInt(id, 10);
  if (isNaN(animalId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const [animal] = await sql`
      SELECT
        a.id, a.name, a.species, a.sex, a.age_years, a.status,
        t.id           AS tag_id,
        t.serial_number AS tag_serial,
        t.last_seen_at,
        bo.id          AS borrower_id,
        bo.name        AS borrower_name,
        bo.cnic,
        bo.phone,
        bo.address,
        l.id           AS loan_id,
        l.loan_number,
        l.amount_pkr,
        l.disbursed_at,
        l.status       AS loan_status,
        br.id          AS branch_id,
        br.name        AS branch_name,
        r.id           AS region_id,
        r.name         AS region_name,
        f.lat, f.lon,
        f.fixed_at     AS last_fix_at,
        f.battery_pct  AS last_battery_pct,
        f.speed_kmh    AS last_speed_kmh,
        f.signal_bars  AS last_signal_bars,
        g.id           AS geofence_id,
        g.name         AS geofence_name,
        g.warning_buffer_m
      FROM   animals   a
      LEFT JOIN tags       t   ON t.id   = a.tag_id
      LEFT JOIN borrowers  bo  ON bo.id  = a.borrower_id
      LEFT JOIN loans      l   ON l.id   = a.loan_id
      JOIN      branches   br  ON br.id  = a.branch_id
      LEFT JOIN regions    r   ON r.id   = br.region_id
      LEFT JOIN animal_geofence ag ON ag.animal_id = a.id AND ag.is_active
      LEFT JOIN geofences  g   ON g.id   = ag.geofence_id
      LEFT JOIN LATERAL (
        SELECT lat, lon, fixed_at, battery_pct, speed_kmh, signal_bars
        FROM   fixes
        WHERE  animal_id = a.id
        ORDER  BY fixed_at DESC
        LIMIT  1
      ) f ON true
      WHERE a.id = ${animalId}
    `;

    if (!animal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Recent events (last 20 alerts)
    const events = await sql`
      SELECT id, type, severity, status, title, detail, created_at
      FROM   alerts
      WHERE  animal_id = ${animalId}
      ORDER  BY created_at DESC
      LIMIT  20
    `;

    return NextResponse.json({ ...animal, events });
  } catch (err) {
    console.error("[api/animals/id]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
