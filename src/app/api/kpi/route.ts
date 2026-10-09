import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [kpi] = await sql`
      SELECT
        COUNT(*)::int                                                    AS total,
        COUNT(*) FILTER (WHERE status = 'inside')::int                  AS inside_count,
        COUNT(*) FILTER (WHERE status = 'breach')::int                  AS breach_count,
        COUNT(*) FILTER (WHERE status = 'stale')::int                   AS stale_count,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE status = 'inside') /
          NULLIF(COUNT(*), 0)
        )::int                                                           AS inside_pct
      FROM animals
    `;

    const [alertRow] = await sql`
      SELECT COUNT(*)::int AS new_alerts
      FROM   alerts
      WHERE  status IN ('new', 'acknowledged')
    `;

    return NextResponse.json({
      total:       kpi.total       ?? 0,
      inside_count: kpi.inside_count ?? 0,
      inside_pct:  kpi.inside_pct  ?? 0,
      breach_count: kpi.breach_count ?? 0,
      stale_count:  kpi.stale_count  ?? 0,
      new_alerts:  alertRow.new_alerts ?? 0,
    });
  } catch (err) {
    console.error("[api/kpi]", err);
    return NextResponse.json(
      { total: 0, inside_count: 0, inside_pct: 0, breach_count: 0, stale_count: 0, new_alerts: 0 },
      { status: 503 },
    );
  }
}
