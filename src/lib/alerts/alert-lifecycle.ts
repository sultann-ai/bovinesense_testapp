/**
 * Alert lifecycle state machine.
 * Valid transitions: new → acknowledged → assigned → resolved
 * Resolution requires a resolution_reason.
 * Every transition is logged to alert_events for audit.
 *
 * Takes a Supabase client from the caller (the server-only admin client in API
 * routes) and an AlertScope, so the alert is looked up and updated only inside the
 * caller's organization (and region / branch, when scoped).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesUpdate } from "../../types/database";
import { assertOk, unwrap, unwrapMaybe } from "../supabase/result";

type Db = SupabaseClient<Database>;
type AlertStatus = Database["public"]["Enums"]["alert_status"];

const VALID_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  new:          ["acknowledged", "assigned", "resolved"],
  acknowledged: ["assigned", "resolved"],
  assigned:     ["resolved"],
  resolved:     [],
};

const RESOLUTION_REASONS = [
  "returned_home",
  "false_alarm",
  "moved_with_consent",
  "escalated_to_recovery",
] as const;
type ResolutionReason = (typeof RESOLUTION_REASONS)[number];

export interface TransitionOptions {
  /** auth.users / profiles id of the person making the change. */
  userId?: string;
  /** auth.users id of the assignee; must be a member of the alert's organization. */
  assigneeId?: string;
  resolutionReason?: ResolutionReason;
  resolutionNote?: string;
  note?: string;
}

/** A business-rule or permission failure (as opposed to an unexpected database error). */
export class AlertTransitionError extends Error {}

/**
 * Which alerts the caller may touch: always their organization, plus their region or
 * branch when the membership is scoped (see scopeMatch in src/lib/auth/api.ts).
 * An alert outside it is reported as not found, exactly like one that does not exist.
 */
// A type alias (not an interface) so it is assignable to the Record<string, unknown> that
// postgrest-js `.match()` accepts.
export type AlertScope = {
  organization_id: string;
  region_id?: number;
  branch_id?: number;
};

export async function transitionAlert(
  db: Db,
  scope: AlertScope,
  alertId: number,
  toStatus: AlertStatus,
  opts: TransitionOptions = {},
): Promise<void> {
  const alert = unwrapMaybe(
    await db
      .from("alert_overview")
      .select("organization_id, status")
      .match(scope)
      .eq("id", alertId)
      .maybeSingle(),
  );
  if (!alert || !alert.status || !alert.organization_id) {
    throw new AlertTransitionError(`Alert ${alertId} not found`);
  }

  const fromStatus = alert.status;
  if (!VALID_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new AlertTransitionError(
      `Invalid transition: ${fromStatus} → ${toStatus}`,
    );
  }

  if (toStatus === "resolved" && !opts.resolutionReason) {
    throw new AlertTransitionError(
      "resolution_reason is required when resolving an alert",
    );
  }

  if (toStatus === "assigned" && !opts.assigneeId) {
    throw new AlertTransitionError("assignee_id is required when assigning an alert");
  }

  if (
    opts.resolutionReason &&
    !(RESOLUTION_REASONS as readonly string[]).includes(opts.resolutionReason)
  ) {
    throw new AlertTransitionError(
      `Unknown resolution_reason: ${opts.resolutionReason}`,
    );
  }

  // Only the fields that change are written (replaces the old COALESCE update).
  const nowIso = new Date().toISOString();
  const patch: TablesUpdate<"alerts"> = { status: toStatus };
  if (toStatus === "acknowledged") patch.acknowledged_at = nowIso;
  if (toStatus === "assigned")     patch.assigned_at     = nowIso;
  if (toStatus === "resolved")     patch.resolved_at     = nowIso;
  if (opts.assigneeId !== undefined)       patch.assignee_id       = opts.assigneeId;
  if (opts.resolutionReason !== undefined) patch.resolution_reason = opts.resolutionReason;
  if (opts.resolutionNote !== undefined)   patch.resolution_note   = opts.resolutionNote;

  // Row Level Security does not raise an error for a refused UPDATE: it just matches no rows.
  // Ask for the row back so "the database said no" is never mistaken for success.
  const updated = unwrap(
    await db
      .from("alerts")
      .update(patch)
      .eq("id", alertId)
      .eq("organization_id", alert.organization_id)
      .select("id"),
  );
  if (updated.length === 0) {
    throw new AlertTransitionError(`Not permitted to change alert ${alertId}`);
  }

  assertOk(
    await db.from("alert_events").insert({
      organization_id: alert.organization_id,
      alert_id:    alertId,
      from_status: fromStatus,
      to_status:   toStatus,
      user_id:     opts.userId ?? null,
      note:        opts.note ?? null,
    }),
  );

  // No notification is sent from here: the UPDATE above reaches every open dashboard through
  // Supabase Realtime (postgres_changes on alerts), filtered by Row Level Security.
}
