import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  const { id } = await params;
  const alertId = parseInt(id, 10);
  if (isNaN(alertId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    // Outside the caller's organization / region / branch looks exactly like "not found".
    const { data: alert, error } = await ctx.db
      .from("alert_overview")
      .select("*")
      .match(scopeMatch(ctx))
      .eq("id", alertId)
      .maybeSingle();
    if (error) throw error;
    if (!alert) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Animal / borrower / latest-fix details that used to come from the same join.
    const { data: animal, error: animalError } = alert.animal_id === null
      ? { data: null, error: null }
      : await ctx.db
          .from("animal_overview")
          .select("species, cnic, phone, amount_pkr, lat, lon, last_fix_at, battery_pct")
          .eq("organization_id", ctx.organizationId)
          .eq("id", alert.animal_id)
          .maybeSingle();
    if (animalError) throw animalError;

    const { data: events, error: eventsError } = await ctx.db
      .from("alert_audit")
      .select("id, from_status, to_status, note, created_at, user_name")
      .eq("organization_id", ctx.organizationId)
      .eq("alert_id", alertId)
      .order("created_at", { ascending: true });
    if (eventsError) throw eventsError;

    return NextResponse.json({
      ...alert,
      species:     animal?.species ?? null,
      cnic:        animal?.cnic ?? null,
      phone:       animal?.phone ?? null,
      amount_pkr:  animal?.amount_pkr ?? null,
      lat:         animal?.lat ?? null,
      lon:         animal?.lon ?? null,
      last_fix_at: animal?.last_fix_at ?? null,
      battery_pct: animal?.battery_pct ?? null,
      audit:       events,
    });
  } catch (err) {
    console.error("[api/alerts/[id]]", err);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
}
