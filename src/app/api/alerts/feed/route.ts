import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const regionId = searchParams.get("region_id");
  const branchId = searchParams.get("branch_id");
  const status   = searchParams.get("status");       // 'new' | 'acknowledged' | 'assigned' | 'resolved'
  const typeFilter = searchParams.get("type");

  try {
    const rows = await sql`
      SELECT
        al.id,
        al.type,
        al.severity,
        al.status,
        al.title,
        al.detail,
        al.distance_km,
        al.created_at,
        al.acknowledged_at,
        al.assigned_at,
        al.resolved_at,
        al.resolution_reason,
        a.id         AS animal_id,
        a.name       AS animal_name,
        a.status     AS animal_status,
        t.serial_number  AS tag_serial,
        bo.name      AS borrower_name,
        l.loan_number,
        br.id        AS branch_id,
        br.name      AS branch_name,
        r.id         AS region_id,
        r.name       AS region_name
      FROM   alerts   al
      JOIN   animals  a   ON a.id   = al.animal_id
      LEFT JOIN tags  t   ON t.id   = al.tag_id
      LEFT JOIN borrowers bo ON bo.id = a.borrower_id
      LEFT JOIN loans     l  ON l.id  = a.loan_id
      JOIN   branches br  ON br.id  = a.branch_id
      LEFT JOIN regions r  ON r.id  = br.region_id
      WHERE  (${regionId}::int IS NULL OR r.id  = ${regionId}::int)
        AND  (${branchId}::int IS NULL OR br.id = ${branchId}::int)
        AND  (${status}  IS NULL OR al.status = ${status}::alert_status)
        AND  (${typeFilter} IS NULL OR al.type = ${typeFilter}::alert_type)
        AND  al.status != 'resolved'
      ORDER  BY al.created_at DESC
      LIMIT  100
    `;

    return NextResponse.json(rows);
  } catch (err) {
    console.error("[api/alerts/feed]", err);
    return NextResponse.json([], { status: 503 });
  }
}
