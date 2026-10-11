import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

/** Branch officers an alert can be assigned to: those of the same branch as the animal. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAccess("alerts:assign");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const alertId = parseInt(id, 10);
  if (isNaN(alertId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { data, error } = await auth.ctx.db.rpc("alert_assignees", { p_alert_id: alertId });
  if (error) {
    console.error("[api/alerts/[id]/assignees]", error);
    return NextResponse.json({ error: "DB error" }, { status: 503 });
  }
  return NextResponse.json(data ?? []);
}
