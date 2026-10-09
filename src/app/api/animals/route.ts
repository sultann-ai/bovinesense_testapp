import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp     = req.nextUrl.searchParams;
  const q      = sp.get("q")?.trim() || null;
  const status = sp.get("status");
  const limit  = Math.min(Number(sp.get("limit") ?? 100), 200);
  const offset = Number(sp.get("offset") ?? 0);

  try {
    const rows = await sql`
      SELECT
        a.id, a.name, a.species, a.status,
        t.serial_number AS tag_serial,
        bo.name         AS borrower_name,
        l.loan_number,
        br.name         AS branch_name,
        a.district,
        f.fixed_at      AS last_fix_at,
        f.battery_pct,
        f.lat, f.lon
      FROM   animals a
      LEFT JOIN tags      t   ON t.id  = a.tag_id
      LEFT JOIN borrowers bo  ON bo.id = a.borrower_id
      LEFT JOIN loans     l   ON l.id  = a.loan_id
      JOIN      branches  br  ON br.id = a.branch_id
      LEFT JOIN LATERAL (
        SELECT fixed_at, battery_pct, lat, lon
        FROM   fixes
        WHERE  animal_id = a.id
        ORDER  BY fixed_at DESC
        LIMIT  1
      ) f ON true
      WHERE (
        ${q}::text IS NULL
        OR t.serial_number ILIKE '%' || ${q} || '%'
        OR bo.name         ILIKE '%' || ${q} || '%'
        OR l.loan_number   ILIKE '%' || ${q} || '%'
        OR a.name          ILIKE '%' || ${q} || '%'
      )
      AND (${status}::text IS NULL OR a.status = ${status}::animal_status)
      ORDER BY
        CASE a.status WHEN 'breach' THEN 0 WHEN 'near' THEN 1 WHEN 'fast' THEN 2 WHEN 'inside' THEN 3 ELSE 4 END,
        f.fixed_at DESC NULLS LAST
      LIMIT  ${limit}
      OFFSET ${offset}
    `;

    return NextResponse.json(rows);
  } catch (err) {
    console.error("[api/animals]", err);
    return NextResponse.json([], { status: 503 });
  }
}
