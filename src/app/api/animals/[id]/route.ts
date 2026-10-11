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
  const animalId = parseInt(id, 10);
  if (isNaN(animalId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    // Outside the caller's organization / region / branch looks exactly like "not found".
    const { data: animal, error } = await ctx.db
      .from("animal_overview")
      .select("*")
      .match(scopeMatch(ctx))
      .eq("id", animalId)
      .maybeSingle();
    if (error) throw error;

    if (!animal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Recent events (last 20 alerts)
    const { data: events, error: eventsError } = await ctx.db
      .from("alerts")
      .select("id, type, severity, status, title, detail, created_at")
      .eq("organization_id", ctx.organizationId)
      .eq("animal_id", animalId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (eventsError) throw eventsError;

    return NextResponse.json({
      id:               animal.id,
      name:             animal.animal_name,
      animal_name:      animal.animal_name,
      species:          animal.species,
      sex:              animal.sex,
      age_years:        animal.age_years,
      status:           animal.status,
      tag_id:           animal.tag_id,
      tag_serial:       animal.tag_serial,
      last_seen_at:     animal.tag_last_seen_at,
      borrower_id:      animal.borrower_id,
      borrower_name:    animal.borrower_name,
      cnic:             animal.cnic,
      phone:            animal.phone,
      address:          animal.address,
      loan_id:          animal.loan_id,
      loan_number:      animal.loan_number,
      amount_pkr:       animal.amount_pkr,
      disbursed_at:     animal.disbursed_at,
      loan_status:      animal.loan_status,
      branch_id:        animal.branch_id,
      branch_name:      animal.branch_name,
      region_id:        animal.region_id,
      region_name:      animal.region_name,
      lat:              animal.lat,
      lon:              animal.lon,
      last_fix_at:      animal.last_fix_at,
      last_battery_pct: animal.battery_pct,
      last_speed_kmh:   animal.speed_kmh,
      last_signal_bars: animal.signal_bars,
      geofence_id:      animal.geofence_id,
      geofence_name:    animal.geofence_name,
      warning_buffer_m: animal.warning_buffer_m,
      events,
    });
  } catch (err) {
    console.error("[api/animals/id]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
