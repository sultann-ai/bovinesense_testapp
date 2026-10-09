import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { transitionAlert, AlertTransitionError } from "../../../../../../db/alert-lifecycle";

const Schema = z.object({
  to_status:         z.enum(["acknowledged", "assigned", "resolved"]),
  user_id:           z.number().int().optional(),
  assignee_id:       z.number().int().optional(),
  resolution_reason: z.enum([
    "returned_home", "false_alarm",
    "moved_with_bank_consent", "escalated_to_recovery",
  ]).optional(),
  resolution_note:   z.string().max(1000).optional(),
  note:              z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const alertId = parseInt(id, 10);
  if (isNaN(alertId)) {
    return NextResponse.json({ error: "Invalid alert id" }, { status: 400 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { to_status, user_id, assignee_id, resolution_reason, resolution_note, note } = parsed.data;

  try {
    await transitionAlert(sql, alertId, to_status, {
      userId: user_id,
      assigneeId: assignee_id,
      resolutionReason: resolution_reason,
      resolutionNote: resolution_note,
      note,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AlertTransitionError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error("[alerts/transition]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
