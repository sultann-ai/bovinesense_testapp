/**
 * Alert lifecycle state machine.
 * Valid transitions: new → acknowledged → assigned → resolved
 * Resolution requires a resolution_reason.
 * Every transition is logged to alert_events for audit.
 */
import postgres from "postgres";
import { emitAlert } from "../src/lib/event-bus";

type AlertStatus = "new" | "acknowledged" | "assigned" | "resolved";

const VALID_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  new:          ["acknowledged", "assigned", "resolved"],
  acknowledged: ["assigned", "resolved"],
  assigned:     ["resolved"],
  resolved:     [],
};

const RESOLUTION_REASONS = [
  "returned_home",
  "false_alarm",
  "moved_with_bank_consent",
  "escalated_to_recovery",
] as const;
type ResolutionReason = (typeof RESOLUTION_REASONS)[number];

export interface TransitionOptions {
  userId?: number;
  assigneeId?: number;
  resolutionReason?: ResolutionReason;
  resolutionNote?: string;
  note?: string;
}

export class AlertTransitionError extends Error {}

export async function transitionAlert(
  sql: postgres.Sql,
  alertId: number,
  toStatus: AlertStatus,
  opts: TransitionOptions = {},
): Promise<void> {
  const [alert] = await sql`
    SELECT a.status, a.animal_id, a.type, a.severity,
           an.branch_id,
           br.region_id
    FROM   alerts  a
    JOIN   animals an ON an.id = a.animal_id
    JOIN   branches br ON br.id = an.branch_id
    WHERE  a.id = ${alertId}
  `;
  if (!alert) throw new AlertTransitionError(`Alert ${alertId} not found`);

  const fromStatus = alert.status as AlertStatus;
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

  if (
    opts.resolutionReason &&
    !(RESOLUTION_REASONS as readonly string[]).includes(opts.resolutionReason)
  ) {
    throw new AlertTransitionError(
      `Unknown resolution_reason: ${opts.resolutionReason}`,
    );
  }

  // Build the update fields
  const now = new Date();

  await sql`
    UPDATE alerts SET
      status            = ${toStatus}::alert_status,
      acknowledged_at   = CASE WHEN ${toStatus} = 'acknowledged' THEN ${now} ELSE acknowledged_at END,
      assigned_at       = CASE WHEN ${toStatus} = 'assigned'     THEN ${now} ELSE assigned_at END,
      resolved_at       = CASE WHEN ${toStatus} = 'resolved'     THEN ${now} ELSE resolved_at END,
      assignee_id       = COALESCE(${opts.assigneeId ?? null}, assignee_id),
      resolution_reason = COALESCE(${opts.resolutionReason ?? null}::resolution_reason, resolution_reason),
      resolution_note   = COALESCE(${opts.resolutionNote ?? null}, resolution_note)
    WHERE id = ${alertId}
  `;

  await sql`
    INSERT INTO alert_events (alert_id, from_status, to_status, user_id, note)
    VALUES (
      ${alertId},
      ${fromStatus}::alert_status,
      ${toStatus}::alert_status,
      ${opts.userId ?? null},
      ${opts.note ?? null}
    )
  `;

  emitAlert({
    alertId,
    alertType: alert.type as string,
    severity:  alert.severity as string,
    status:    toStatus,
    animalId:  alert.animal_id as number,
    branchId:  alert.branch_id as number,
    regionId:  alert.region_id as number,
  });
}
