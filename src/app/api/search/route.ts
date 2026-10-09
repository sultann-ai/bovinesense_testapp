import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  try {
    const rows = await sql`
      SELECT
        a.id         AS animal_id,
        a.name       AS animal_name,
        a.status,
        t.serial_number AS tag_serial,
        bo.name      AS borrower_name,
        l.loan_number,
        br.name      AS branch_name,
        f.lat, f.lon
      FROM   animals a
      LEFT JOIN tags      t   ON t.id  = a.tag_id
      LEFT JOIN borrowers bo  ON bo.id = a.borrower_id
      LEFT JOIN loans     l   ON l.id  = a.loan_id
      JOIN      branches  br  ON br.id = a.branch_id
      LEFT JOIN LATERAL (
        SELECT lat, lon
        FROM   fixes
        WHERE  animal_id = a.id
        ORDER  BY fixed_at DESC
        LIMIT  1
      ) f ON true
      WHERE
        t.serial_number ILIKE '%' || ${q} || '%'
        OR bo.name       ILIKE '%' || ${q} || '%'
        OR l.loan_number ILIKE '%' || ${q} || '%'
        OR a.name        ILIKE '%' || ${q} || '%'
      LIMIT 8
    `;

    return NextResponse.json(rows);
  } catch (err) {
    console.error("[api/search]", err);
    return NextResponse.json([]);
  }
}
