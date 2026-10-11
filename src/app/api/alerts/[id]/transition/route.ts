import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAccess, scopeMatch } from "@/lib/auth/api";
import { can, permissionForTransition } from "@/lib/permissions";
import { transitionAlert, AlertTransitionError } from "@/lib/alerts/alert-lifecycle";

// Note what is NOT accepted: a user id. Who performed the change is always the
// signed-in user, taken from the verified session on the server. A `user_id` sent in
// the body is ignored (zod strips unknown keys), so the audit trail cannot be spoofed.
const Schema = z.object({
  to_status:         z.enum(["acknowledged", "assigned", "resolved"]),
  assignee_id:       z.string().uuid().optional(),
  resolution_reason: z.enum([
    "returned_home", "false_alarm",
    "moved_with_consent", "escalated_to_recovery",
  ]).optional(),
  resolution_note:   z.string().max(1000).optional(),
  note:              z.string().max(500).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAccess();
  if (!auth.ok) return auth.response;
  const { ctx } = auth;

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

  const { to_status, assignee_id, resolution_reason, resolution_note, note } = parsed.data;

  // Acknowledge, assign and resolve are separate permissions. Auditors and platform admins hold
  // none of them. (The database enforces the same rule; this answers early with a clear message.)
  if (!can(ctx.role, permissionForTransition(to_status))) {
    return NextResponse.json({ error: "Forbidden", code: "forbidden" }, { status: 403 });
  }

  // The assignee must be a branch officer of the animal's branch (the same list the UI offers).
  let auditNote = note;
  if (to_status === "assigned") {
    if (!assignee_id) {
      return NextResponse.json({ error: "Choose who to assign this alert to." }, { status: 422 });
    }
    const { data: officers, error } = await ctx.db.rpc("alert_assignees", { p_alert_id: alertId });
    if (error) {
      console.error("[alerts/transition] assignees", error);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    const assignee = (officers ?? []).find((o) => o.user_id === assignee_id);
    if (!assignee) {
      return NextResponse.json({ error: "Assignee must be a branch officer of this animal's branch." }, { status: 422 });
    }
    auditNote = note ?? `Assigned to ${assignee.full_name}`;
  }

  // The audit row carries the reason (and the optional note) so the trail reads on its own.
  if (to_status === "resolved") {
    const reason = resolution_reason?.replace(/_/g, " ");
    auditNote = [reason && `Reason: ${reason}`, resolution_note ?? note].filter(Boolean).join(" — ") || undefined;
  }

  try {
    await transitionAlert(ctx.db, scopeMatch(ctx), alertId, to_status, {
      userId: ctx.user.id,
      assigneeId: assignee_id,
      resolutionReason: resolution_reason,
      resolutionNote: resolution_note,
      note: auditNote,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AlertTransitionError) {
      // "not found" (including alerts outside the caller's scope) is a 404; a bad
      // state change is a 422.
      const status = /not found/i.test(err.message) ? 404 : /not permitted/i.test(err.message) ? 403 : 422;
      return NextResponse.json({ error: err.message }, { status });
    }
    // e.g. the assignee is not a member of this organization (foreign key violation)
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23503") {
      return NextResponse.json({ error: "Assignee is not a member of this organization." }, { status: 422 });
    }
    console.error("[alerts/transition]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
