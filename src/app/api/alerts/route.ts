import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";
import { Constants } from "@/types/database";
import { clampInt, dateParam, enumParam, intParam } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const sp       = req.nextUrl.searchParams;
  const type     = enumParam(sp.get("type"), Constants.public.Enums.alert_type);
  const severity = enumParam(sp.get("severity"), Constants.public.Enums.alert_severity);
  const status   = enumParam(sp.get("status"), Constants.public.Enums.alert_status);
  const regionId = intParam(sp.get("region_id"));
  const branchId = intParam(sp.get("branch_id"));
  const fromDate = dateParam(sp.get("from_date"));
  const toDate   = dateParam(sp.get("to_date"));
  const limit    = clampInt(sp.get("limit"), 100, 1, 200);
  const offset   = clampInt(sp.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);

  if (
    !type.ok || !severity.ok || !status.ok ||
    Number.isNaN(regionId) || Number.isNaN(branchId) || fromDate === undefined || toDate === undefined
  ) {
    return NextResponse.json({ error: "Invalid filter" }, { status: 400 });
  }

  try {
    let query = ctx.db
      .from("alert_overview")
      .select(
        "id, type, severity, status, title, detail, distance_km, created_at, acknowledged_at, assigned_at, resolved_at, resolution_reason, resolution_note, animal_id, animal_name, tag_serial, borrower_name, loan_number, branch_id, branch_name",
      )
      .match(scopeMatch(ctx));

    if (type.value)     query = query.eq("type", type.value);
    if (severity.value) query = query.eq("severity", severity.value);
    if (status.value)   query = query.eq("status", status.value);
    if (regionId !== null) query = query.eq("region_id", regionId);
    if (branchId !== null) query = query.eq("branch_id", branchId);
    if (fromDate) query = query.gte("created_at", fromDate.toISOString());
    if (toDate) {
      // Inclusive of the whole "to" day, as before.
      const end = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
      query = query.lte("created_at", end.toISOString());
    }

    const { data, error } = await query
      .order("status_rank", { ascending: true })
      .order("severity_rank", { ascending: true })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/alerts]", err);
    return NextResponse.json([], { status: 503 });
  }
}
