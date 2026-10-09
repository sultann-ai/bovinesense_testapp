import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const alertId = parseInt(id, 10);
  if (isNaN(alertId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const [alert] = await sql`
      SELECT
        al.id, al.type, al.severity, al.status,
        al.title, al.detail, al.distance_km,
        al.created_at, al.acknowledged_at, al.assigned_at, al.resolved_at,
        al.resolution_reason, al.resolution_note,
        a.id         AS animal_id,
        a.name       AS animal_name,
        a.species, a.status AS animal_status,
        t.serial_number AS tag_serial,
        bo.id        AS borrower_id,
        bo.name      AS borrower_name,
        bo.cnic, bo.phone,
        l.loan_number, l.amount_pkr,
        br.name      AS branch_name,
        f.lat, f.lon, f.fixed_at AS last_fix_at, f.battery_pct
      FROM   alerts   al
      JOIN   animals  a   ON a.id  = al.animal_id
      LEFT JOIN tags  t   ON t.id  = al.tag_id
      LEFT JOIN borrowers bo ON bo.id = a.borrower_id
      LEFT JOIN loans l   ON l.id  = a.loan_id
      JOIN   branches br  ON br.id = a.branch_id
      LEFT JOIN LATERAL (
        SELECT lat, lon, fixed_at, battery_pct
        FROM   fixes
        WHERE  animal_id = a.id
        ORDER  BY fixed_at DESC
        LIMIT  1
      ) f ON true
      WHERE al.id = ${alertId}
    `;

    if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const events = await sql`
      SELECT
        ae.id, ae.from_status, ae.to_status, ae.note, ae.created_at,
        u.name AS user_name
      FROM   alert_events ae
      LEFT JOIN users u ON u.id = ae.user_id
      WHERE  ae.alert_id = ${alertId}
      ORDER  BY ae.created_at ASC
    `;

    return NextResponse.json({ ...alert, audit: events });
  } catch (err) {
    console.error("[api/alerts/[id]]", err);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
}
