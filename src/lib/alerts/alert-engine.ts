/**
 * @deprecated Superseded by the Postgres function `public.ingest_fix()`
 * (supabase/migrations/20261009000006_ingestion.sql), which stores the fix and runs the alert
 * rules in one transaction, with per-organization thresholds. Nothing calls this file any more.
 * It is kept only for reference until removal is approved. Do not extend it: change the SQL.
 *
 * Alert engine — ran after every ingested fix.
 *
 * Rules (§7 DESIGN.md):
 *  Breach      : 2 consecutive outside  OR  1 fix ≥ 200 m outside (hardcoded)
 *  Near        : inside warning buffer  OR  outside but < 200 m (single fix)
 *  Fast        : speed > 15 km/h (computed from coords if tag doesn't report it)
 *  Returned    : was breach, now inside — raises info event, never auto-resolves
 *  Low battery : < 20 %
 *
 * Tag-offline is checked by checkOfflineTags() (periodic scheduler, not per-fix).
 *
 * Data access goes through a Supabase client passed in by the caller (the
 * server-only admin client in API routes). Spatial work happens in Postgres via
 * the fence_spatial_context / animal_has_prior_outside_fix functions; the rules
 * themselves are still the pure functions in ./alert-rules.
 *
 * This is a straight port of the previous postgres.js implementation. The
 * alert-engine module moves the whole thing into SQL.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Enums } from "../../types/database";
import {
  computeSpeedKmh,
  evaluateAlerts,
  nextAnimalStatus,
  type SpatialContext,
} from "./alert-rules";
import { assertOk, unwrap, unwrapMaybe } from "../supabase/result";

type Db = SupabaseClient<Database>;

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

export async function runAlertEngine(db: Db, fix: FixPayload): Promise<number[]> {
  // ── 1. Load animal, fence, and branch/region ───────────────────────────────
  const animal = unwrapMaybe(
    await db
      .from("animal_overview")
      .select(
        "id, organization_id, status, animal_name, borrower_name, loan_number, branch_id, region_id, geofence_id, warning_buffer_m",
      )
      .eq("id", fix.animalId)
      .maybeSingle(),
  );
  if (!animal?.geofence_id) return [];

  // Every alert and audit row is stamped with the animal's organization; the
  // composite foreign keys reject it if it disagrees with the animal or tag.
  const organizationId = animal.organization_id;
  if (!organizationId) throw new Error(`Animal ${fix.animalId} has no organization`);
  const geofenceId     = animal.geofence_id;
  const warningBufferM = animal.warning_buffer_m ?? 500;
  const prevStatus     = animal.status ?? "inside";

  // ── 2. Spatial check ───────────────────────────────────────────────────────
  const spatialRows = unwrap(
    await db.rpc("fence_spatial_context", {
      p_geofence_id: geofenceId,
      p_lon:         fix.lon,
      p_lat:         fix.lat,
    }),
  );
  const spatial = spatialRows[0];
  if (!spatial) throw new Error(`Geofence ${geofenceId} not found`);

  const insideFence   = spatial.inside_fence;
  const metresOutside = insideFence ? 0 : spatial.metres_outside;
  const metresToEdge  = spatial.metres_to_edge;

  // ── 3. Consecutive outside count ──────────────────────────────────────────
  let consecutiveOutsideCount = insideFence ? 0 : 1;
  if (!insideFence) {
    const hasPrior = unwrap(
      await db.rpc("animal_has_prior_outside_fix", {
        p_animal_id:   fix.animalId,
        p_fix_id:      fix.fixId,
        p_geofence_id: geofenceId,
      }),
    );
    if (hasPrior) consecutiveOutsideCount = 2;
  }

  // ── 4. Speed from coordinates if not provided by the tag ──────────────────
  let speedKmh = fix.speedKmh;
  if (speedKmh === null) {
    const [prevFix] = unwrap(
      await db
        .from("fixes")
        .select("lat, lon, fixed_at")
        .eq("animal_id", fix.animalId)
        .lt("id", fix.fixId)
        .order("fixed_at", { ascending: false })
        .limit(1),
    );
    if (prevFix) {
      speedKmh = computeSpeedKmh(
        prevFix.lat, prevFix.lon, new Date(prevFix.fixed_at),
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
    loanNumber: animal.loan_number,
  });

  // ── 6. Persist alerts and write audit log entries ─────────────────────────
  const raisedAlertIds: number[] = [];

  for (const d of decisions) {
    // Deduplicate low_battery: skip if an open alert already exists
    if (d.type === "low_battery") {
      const existing = unwrap(
        await db
          .from("alerts")
          .select("id")
          .eq("animal_id", fix.animalId)
          .eq("type", "low_battery")
          .neq("status", "resolved")
          .limit(1),
      );
      if (existing.length > 0) continue;
    }

    const inserted = unwrap(
      await db
        .from("alerts")
        .insert({
          organization_id: organizationId,
          animal_id:   fix.animalId,
          tag_id:      fix.tagId,
          type:        d.type,
          severity:    d.severity,
          status:      "new",
          title:       d.title,
          detail:      d.detail,
          distance_km: d.distanceKm ?? null,
        })
        .select("id")
        .single(),
    );

    // Audit log: system-created entry (no user_id)
    assertOk(
      await db
        .from("alert_events")
        .insert({ organization_id: organizationId, alert_id: inserted.id, from_status: null, to_status: "new" }),
    );

    raisedAlertIds.push(inserted.id);

  }

  // ── 7. Update animal status ────────────────────────────────────────────────
  const isFast = speedKmh !== null && speedKmh > 15;
  const newStatus = nextAnimalStatus(prevStatus, spatialCtx, isFast) as Enums<"animal_status">;
  if (newStatus !== prevStatus) {
    assertOk(await db.from("animals").update({ status: newStatus }).eq("id", fix.animalId));
  }

  // ── 8. Update tag last_seen_at ─────────────────────────────────────────────
  assertOk(
    await db
      .from("tags")
      .update({ last_seen_at: fix.fixedAt.toISOString() })
      .eq("id", fix.tagId),
  );

  return raisedAlertIds;
}

// ─── Offline check — call periodically (e.g. every 15 min) ───────────────────
export async function checkOfflineTags(db: Db, thresholdHours = 6): Promise<number> {
  const stale = unwrap(
    await db.rpc("find_offline_animals", { p_threshold_hours: thresholdHours }),
  );

  for (const row of stale) {
    const detail = `No fix in ${thresholdHours} h · ${row.animal_name ?? "Animal"} (${row.borrower_name}) · ${row.loan_number ?? ""}`;

    const inserted = unwrap(
      await db
        .from("alerts")
        .insert({
          organization_id: row.organization_id,
          animal_id: row.animal_id,
          tag_id:    row.tag_id,
          type:      "tag_offline",
          severity:  "warning",
          status:    "new",
          title:     "Tag offline",
          detail,
        })
        .select("id")
        .single(),
    );

    assertOk(
      await db
        .from("alert_events")
        .insert({ organization_id: row.organization_id, alert_id: inserted.id, from_status: null, to_status: "new" }),
    );

    assertOk(await db.from("animals").update({ status: "stale" }).eq("id", row.animal_id));

  }

  return stale.length;
}
