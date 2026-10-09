/**
 * Alert engine — runs after every ingested fix.
 *
 * Rules (§7 DESIGN.md):
 *  Breach      : 2 consecutive outside  OR  1 fix ≥ 200 m outside (hardcoded)
 *  Near        : inside warning buffer  OR  outside but < 200 m (single fix)
 *  Fast        : speed > 15 km/h (computed from coords if tag doesn't report it)
 *  Returned    : was breach, now inside — raises info event, never auto-resolves
 *  Low battery : < 20 %
 *
 * Tag-offline is checked by checkOfflineTags() (periodic scheduler, not per-fix).
 */
import postgres from "postgres";
import {
  HARD_BREACH_METRES,
  computeSpeedKmh,
  evaluateAlerts,
  isBreachCondition,
  nextAnimalStatus,
  type SpatialContext,
} from "./alert-rules";
import { emitAlert, emitFix } from "../src/lib/event-bus";

export interface FixPayload {
  fixId:      number;
  tagId:      number;
  animalId:   number;
  lat:        number;
  lon:        number;
  fixedAt:    Date;
  speedKmh:   number | null;
  batteryPct: number | null;
}

export async function runAlertEngine(sql: postgres.Sql, fix: FixPayload) {
  // ── 1. Load animal, fence, and branch/region ───────────────────────────────
  const [animal] = await sql`
    SELECT a.id, a.status,
           a.name          AS animal_name,
           b.name          AS borrower_name,
           l.loan_number,
           br.id           AS branch_id,
           br.name         AS branch_name,
           r.id            AS region_id,
           ag.geofence_id,
           g.warning_buffer_m
    FROM   animals      a
    JOIN   borrowers    b   ON b.id  = a.borrower_id
    LEFT JOIN loans     l   ON l.id  = a.loan_id
    JOIN   branches     br  ON br.id = a.branch_id
    LEFT JOIN regions   r   ON r.id  = br.region_id
    LEFT JOIN animal_geofence ag ON ag.animal_id = a.id AND ag.is_active
    LEFT JOIN geofences g   ON g.id  = ag.geofence_id
    WHERE  a.id = ${fix.animalId}
  `;
  if (!animal?.geofence_id) return;

  const geofenceId    = animal.geofence_id as number;
  const warningBufferM = (animal.warning_buffer_m as number) ?? 500;
  const prevStatus    = animal.status as string;
  const branchId      = animal.branch_id as number;
  const regionId      = animal.region_id as number;

  // ── 2. Spatial check ───────────────────────────────────────────────────────
  const [spatial] = await sql`
    SELECT
      ST_Contains(g.geom, ST_SetSRID(ST_Point(${fix.lon}, ${fix.lat}), 4326))
        AS inside_fence,
      ST_Distance(
        g.geom::geography,
        ST_SetSRID(ST_Point(${fix.lon}, ${fix.lat}), 4326)::geography
      ) AS metres_outside,
      ST_Distance(
        ST_Boundary(g.geom)::geography,
        ST_SetSRID(ST_Point(${fix.lon}, ${fix.lat}), 4326)::geography
      ) AS metres_to_edge
    FROM geofences g
    WHERE g.id = ${geofenceId}
  `;

  const insideFence  = spatial.inside_fence  as boolean;
  const metresOutside = insideFence ? 0 : (spatial.metres_outside as number);
  const metresToEdge = spatial.metres_to_edge as number;

  // ── 3. Consecutive outside count ──────────────────────────────────────────
  // We only need to know if the immediately preceding fix is also outside.
  let consecutiveOutsideCount = insideFence ? 0 : 1;
  if (!insideFence) {
    const [prevFix] = await sql`
      SELECT id FROM fixes
      WHERE animal_id = ${fix.animalId}
        AND id        < ${fix.fixId}
        AND NOT ST_Contains(
              (SELECT geom FROM geofences WHERE id = ${geofenceId}),
              geom
            )
      ORDER BY fixed_at DESC
      LIMIT 1
    `;
    if (prevFix) consecutiveOutsideCount = 2;
  }

  // ── 4. Speed from coordinates if not provided by the tag ──────────────────
  let speedKmh = fix.speedKmh;
  if (speedKmh === null) {
    const [prevFix] = await sql`
      SELECT lat, lon, fixed_at FROM fixes
      WHERE animal_id = ${fix.animalId}
        AND id        < ${fix.fixId}
      ORDER BY fixed_at DESC
      LIMIT 1
    `;
    if (prevFix) {
      speedKmh = computeSpeedKmh(
        prevFix.lat as number, prevFix.lon as number, prevFix.fixed_at as Date,
        fix.lat, fix.lon, fix.fixedAt,
      );
    }
  }

  // ── 5. Build context and evaluate rules ───────────────────────────────────
  const spatialCtx: SpatialContext = {
    insideFence,
    metresOutside,
    metresToEdge,
    consecutiveOutsideCount,
    warningBufferM,
  };

  const decisions = evaluateAlerts({
    prevStatus,
    speedKmh,
    batteryPct: fix.batteryPct,
    spatial: spatialCtx,
    animalLabel: `${animal.animal_name ?? "Animal"} (${animal.borrower_name})`,
    loanNumber: animal.loan_number as string | null,
  });

  // ── 6. Persist alerts and write audit log entries ─────────────────────────
  const raisedAlertIds: number[] = [];

  for (const d of decisions) {
    // Deduplicate low_battery: skip if an open alert already exists
    if (d.type === "low_battery") {
      const [existing] = await sql`
        SELECT id FROM alerts
        WHERE animal_id = ${fix.animalId}
          AND type      = 'low_battery'
          AND status   != 'resolved'
        LIMIT 1
      `;
      if (existing) continue;
    }

    const [inserted] = await sql`
      INSERT INTO alerts (animal_id, tag_id, type, severity, status, title, detail, distance_km)
      VALUES (
        ${fix.animalId}, ${fix.tagId},
        ${d.type}::alert_type,
        ${d.severity}::alert_severity,
        'new',
        ${d.title},
        ${d.detail},
        ${d.distanceKm ?? null}
      )
      RETURNING id
    `;

    // Audit log: system-created entry (no user_id)
    await sql`
      INSERT INTO alert_events (alert_id, from_status, to_status)
      VALUES (${inserted.id}, NULL, 'new')
    `;

    raisedAlertIds.push(inserted.id as number);

    emitAlert({
      alertId:   inserted.id as number,
      alertType: d.type,
      severity:  d.severity,
      status:    "new",
      animalId:  fix.animalId,
      branchId,
      regionId,
    });
  }

  // ── 7. Update animal status ────────────────────────────────────────────────
  const isFast = speedKmh !== null && speedKmh > 15;
  const newStatus = nextAnimalStatus(prevStatus, spatialCtx, isFast);
  if (newStatus !== prevStatus) {
    await sql`UPDATE animals SET status = ${newStatus}::animal_status WHERE id = ${fix.animalId}`;
  }

  // ── 8. Update tag last_seen_at ─────────────────────────────────────────────
  await sql`UPDATE tags SET last_seen_at = ${fix.fixedAt} WHERE id = ${fix.tagId}`;

  // ── 9. Emit fix event for SSE consumers ───────────────────────────────────
  emitFix({
    animalId: fix.animalId,
    tagId:    fix.tagId,
    lat:      fix.lat,
    lon:      fix.lon,
    fixedAt:  fix.fixedAt.toISOString(),
    branchId,
    regionId,
  });

  return raisedAlertIds;
}

// ─── Offline check — call periodically (e.g. every 15 min) ───────────────────
export async function checkOfflineTags(
  sql: postgres.Sql,
  thresholdHours = 6,
) {
  const stale = await sql`
    SELECT a.id  AS animal_id,
           a.name,
           t.id  AS tag_id,
           b.name  AS borrower_name,
           l.loan_number,
           br.id   AS branch_id,
           r.id    AS region_id
    FROM   animals   a
    JOIN   tags      t  ON t.id  = a.tag_id
    LEFT JOIN borrowers b  ON b.id  = a.borrower_id
    LEFT JOIN loans     l  ON l.id  = a.loan_id
    JOIN   branches  br ON br.id = a.branch_id
    LEFT JOIN regions r  ON r.id  = br.region_id
    WHERE  a.status != 'stale'
      AND (t.last_seen_at IS NULL
           OR t.last_seen_at < NOW() - make_interval(hours => ${thresholdHours}))
  `;

  for (const row of stale) {
    const detail = `No fix in ${thresholdHours} h · ${row.name ?? "Animal"} (${row.borrower_name}) · ${row.loan_number ?? ""}`;

    const [inserted] = await sql`
      INSERT INTO alerts (animal_id, tag_id, type, severity, status, title, detail)
      VALUES (${row.animal_id}, ${row.tag_id}, 'tag_offline', 'warning', 'new', 'Tag offline', ${detail})
      RETURNING id
    `;

    await sql`
      INSERT INTO alert_events (alert_id, from_status, to_status)
      VALUES (${inserted.id}, NULL, 'new')
    `;

    await sql`UPDATE animals SET status = 'stale' WHERE id = ${row.animal_id}`;

    emitAlert({
      alertId:   inserted.id as number,
      alertType: "tag_offline",
      severity:  "warning",
      status:    "new",
      animalId:  row.animal_id as number,
      branchId:  row.branch_id as number,
      regionId:  row.region_id as number,
    });
  }

  return stale.length;
}
