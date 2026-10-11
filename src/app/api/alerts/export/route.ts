import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";
import { Constants } from "@/types/database";
import { dateParam, enumParam, intParam } from "@/lib/api-helpers";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Rows are read in pages of this size, up to MAX_ROWS in one file. */
const PAGE = 1000;
const MAX_ROWS = 10_000;

const HEADER = [
  "Alert ID", "Raised (UTC)", "Type", "Severity", "State", "Title", "Detail", "Distance outside (m)",
  "Tag ID", "Borrower", "Loan ID", "Branch", "Acknowledged (UTC)", "Assigned (UTC)", "Resolved (UTC)",
  "Resolution reason", "Resolution note",
] as const;

/**
 * GET /api/alerts/export: the same filters as /api/alerts (type, status, branch_id, region_id,
 * from_date, to_date, plus the caller's own scope), returned as a CSV file. A member exports exactly
 * what they can see; Row Level Security and the scope apply as usual.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const sp       = req.nextUrl.searchParams;
  const type     = enumParam(sp.get("type"), Constants.public.Enums.alert_type);
  const status   = enumParam(sp.get("status"), Constants.public.Enums.alert_status);
  const regionId = intParam(sp.get("region_id"));
  const branchId = intParam(sp.get("branch_id"));
  const fromDate = dateParam(sp.get("from_date"));
  const toDate   = dateParam(sp.get("to_date"));
  if (!type.ok || !status.ok || Number.isNaN(regionId) || Number.isNaN(branchId) || fromDate === undefined || toDate === undefined) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  const rows: unknown[][] = [];
  try {
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
      let query = ctx.db
        .from("alert_overview")
        .select("id, type, severity, status, title, detail, distance_km, created_at, acknowledged_at, assigned_at, resolved_at, resolution_reason, resolution_note, tag_serial, borrower_name, loan_number, branch_name")
        .match(scopeMatch(ctx));
      if (type.value)        query = query.eq("type", type.value);
      if (status.value)      query = query.eq("status", status.value);
      if (regionId !== null) query = query.eq("region_id", regionId);
      if (branchId !== null) query = query.eq("branch_id", branchId);
      if (fromDate)          query = query.gte("created_at", fromDate.toISOString());
      // The whole "to" day is included.
      if (toDate)            query = query.lt("created_at", new Date(toDate.getTime() + 24 * 60 * 60 * 1000).toISOString());

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;

      for (const a of data) {
        rows.push([
          a.id, a.created_at, a.type, a.severity, a.status, a.title, a.detail,
          a.distance_km === null ? null : Math.round(a.distance_km * 1000),
          a.tag_serial, a.borrower_name, a.loan_number, a.branch_name,
          a.acknowledged_at, a.assigned_at, a.resolved_at, a.resolution_reason, a.resolution_note,
        ]);
      }
      if (data.length < PAGE) break;
    }
  } catch (err) {
    console.error("[api/alerts/export]", err);
    return NextResponse.json({ error: "The alerts could not be exported." }, { status: 503 });
  }

  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(HEADER, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="alerts-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
