import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type     = sp.get("type");
  const severity = sp.get("severity");
  const status   = sp.get("status");
  const branchId = sp.get("branch_id");
  const fromDate = sp.get("from_date");
  const toDate   = sp.get("to_date");
  const limit    = Math.min(Number(sp.get("limit") ?? 100), 200);
  const offset   = Number(sp.get("offset") ?? 0);

  try {
    const rows = await sql`
      SELECT
        al.id, al.type, al.severity, al.status,
        al.title, al.detail, al.distance_km,
        al.created_at, al.acknowledged_at, al.assigned_at, al.resolved_at,
        al.resolution_reason, al.resolution_note,
        a.id         AS animal_id,
        a.name       AS animal_name,
        t.serial_number AS tag_serial,
        bo.name      AS borrower_name,
        l.loan_number,
        br.id        AS branch_id,
        br.name      AS branch_name
      FROM   alerts   al
      JOIN   animals  a   ON a.id  = al.animal_id
      LEFT JOIN tags  t   ON t.id  = al.tag_id
      LEFT JOIN borrowers bo ON bo.id = a.borrower_id
      LEFT JOIN loans l   ON l.id  = a.loan_id
      JOIN   branches br  ON br.id = a.branch_id
      WHERE  (${type}::text     IS NULL OR al.type     = ${type}::alert_type)
        AND  (${severity}::text IS NULL OR al.severity = ${severity}::alert_severity)
        AND  (${status}::text   IS NULL OR al.status   = ${status}::alert_status)
        AND  (${branchId}::int  IS NULL OR br.id       = ${branchId}::int)
        AND  (${fromDate}::date IS NULL OR al.created_at >= ${fromDate}::timestamptz)
        AND  (${toDate}::date   IS NULL OR al.created_at <= (${toDate}::date + INTERVAL '1 day'))
      ORDER BY
        CASE al.status   WHEN 'new' THEN 0 WHEN 'acknowledged' THEN 1 WHEN 'assigned' THEN 2 ELSE 3 END,
        CASE al.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        al.created_at DESC
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    return NextResponse.json(rows);
  } catch (err) {
    console.error("[api/alerts]", err);
    return NextResponse.json([], { status: 503 });
  }
}
