import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

/** The tag inventory: every tag the caller may see, with battery, signal, last contact and whether it is unassigned. */
export async function GET() {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

  try {
    const { data, error } = await ctx.db
      .from("device_overview")
      .select("id, serial_number, is_simulated, last_seen_at, animal_id, animal_name, is_unassigned, battery_pct, signal_bars, last_fix_at")
      .eq("organization_id", ctx.organizationId)
      .order("is_unassigned", { ascending: false })
      .order("last_seen_at", { ascending: true, nullsFirst: true })
      .limit(500);
    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    console.error("[api/devices]", err);
    return NextResponse.json([], { status: 503 });
  }
}
