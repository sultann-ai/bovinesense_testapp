/**
 * Pure alert-rule functions — no DB I/O, fully unit-testable.
 * The engine queries the DB to build the context, then calls these.
 */

export const HARD_BREACH_METRES = 200;
export const SPEED_THRESHOLD_KMH = 15;
export const LOW_BATTERY_THRESHOLD = 20;

export function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeSpeedKmh(
  lat1: number, lon1: number, t1: Date,
  lat2: number, lon2: number, t2: Date,
): number {
  const distKm = haversineKm(lat1, lon1, lat2, lon2);
  const hrs = (t2.getTime() - t1.getTime()) / 3_600_000;
  if (hrs <= 0) return 0;
  return distKm / hrs;
}

export interface SpatialContext {
  insideFence: boolean;
  metresOutside: number;
  metresToEdge: number;
  consecutiveOutsideCount: number;
  warningBufferM: number;
}

export interface AlertFixContext {
  prevStatus: string;
  speedKmh: number | null;
  batteryPct: number | null;
  spatial: SpatialContext;
  animalLabel: string;
  loanNumber: string | null;
}

export type AlertType =
  | "breach"
  | "near_boundary"
  | "fast_movement"
  | "low_battery"
  | "returned";

export type AlertSeverity = "critical" | "warning" | "info";

export interface AlertDecision {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
  distanceKm?: number;
}

export function isBreachCondition(spatial: SpatialContext): boolean {
  return (
    !spatial.insideFence &&
    (spatial.consecutiveOutsideCount >= 2 ||
      spatial.metresOutside >= HARD_BREACH_METRES)
  );
}

export function nextAnimalStatus(
  prevStatus: string,
  spatial: SpatialContext,
  isFast: boolean,
): string {
  if (prevStatus === "breach") {
    return spatial.insideFence ? "inside" : "breach";
  }
  if (!spatial.insideFence) {
    return isBreachCondition(spatial) ? "breach" : "near";
  }
  if (spatial.metresToEdge < spatial.warningBufferM) return "near";
  if (isFast) return "fast";
  return "inside";
}

export function evaluateAlerts(ctx: AlertFixContext): AlertDecision[] {
  const { spatial, prevStatus, speedKmh, batteryPct } = ctx;
  const decisions: AlertDecision[] = [];

  const isFast = speedKmh !== null && speedKmh > SPEED_THRESHOLD_KMH;
  const breach = isBreachCondition(spatial);

  // Breach: new breach state (don't re-raise if already breached)
  if (breach && prevStatus !== "breach") {
    const distKm = spatial.metresOutside / 1000;
    decisions.push({
      type: "breach",
      severity: "critical",
      title: "Left district boundary",
      detail: `${distKm.toFixed(2)} km outside boundary · ${ctx.animalLabel}${ctx.loanNumber ? ` · ${ctx.loanNumber}` : ""}`,
      distanceKm: distKm,
    });
  }

  // Near boundary — outside but below hard threshold (only on transition from inside)
  if (!spatial.insideFence && !breach && prevStatus === "inside") {
    const distKm = spatial.metresOutside / 1000;
    decisions.push({
      type: "near_boundary",
      severity: "warning",
      title: "Near district boundary",
      detail: `${spatial.metresOutside.toFixed(0)} m outside boundary · ${ctx.animalLabel}`,
      distanceKm: distKm,
    });
  }

  // Near boundary — inside but within warning buffer (only on transition from inside)
  if (
    spatial.insideFence &&
    spatial.metresToEdge < spatial.warningBufferM &&
    prevStatus === "inside"
  ) {
    decisions.push({
      type: "near_boundary",
      severity: "warning",
      title: "Approaching district boundary",
      detail: `${spatial.metresToEdge.toFixed(0)} m from boundary inside fence · ${ctx.animalLabel}`,
    });
  }

  // Returned: was in breach, now inside — never auto-resolves the breach alert
  if (prevStatus === "breach" && spatial.insideFence) {
    decisions.push({
      type: "returned",
      severity: "info",
      title: "Returned to boundary",
      detail: `Animal back inside geofence — open breach alert must still be resolved manually · ${ctx.animalLabel}`,
    });
  }

  // Fast movement
  if (isFast) {
    decisions.push({
      type: "fast_movement",
      severity: "critical",
      title: "Fast movement detected",
      detail: `${speedKmh!.toFixed(0)} km/h — possible vehicle transport · ${ctx.animalLabel}${ctx.loanNumber ? ` · ${ctx.loanNumber}` : ""}`,
    });
  }

  // Low battery (deduplication against open alerts is done at the engine level)
  if (batteryPct !== null && batteryPct < LOW_BATTERY_THRESHOLD) {
    decisions.push({
      type: "low_battery",
      severity: "info",
      title: "Low battery",
      detail: `Battery at ${batteryPct}% · ${ctx.animalLabel}`,
    });
  }

  return decisions;
}
