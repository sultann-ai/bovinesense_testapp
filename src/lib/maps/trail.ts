/**
 * The 24 h / 7 day trail: parsing the API's GeoJSON and the playback maths. Pure and client-safe.
 *
 * DESIGN.md §6 "Trail and playback": a 2 px charcoal line with a dot per fix (hover shows time and
 * speed), and a slider that scrubs through the fixes. Dots, not a smooth curve: the gaps between
 * fixes are real, so playback steps from one fix to the next and never animates between them.
 */
import { boundsOfPositions, type Position } from "./geo";
import type { Bounds } from "./regions";

export interface TrailPoint {
  id: number;
  lat: number;
  lon: number;
  fixedAt: string;
  speedKmh: number | null;
  batteryPct: number | null;
}

export const TRAIL_WINDOWS = [
  { hours: 24, label: "24 h" },
  { hours: 168, label: "7 days" },
] as const;
export type TrailHours = (typeof TRAIL_WINDOWS)[number]["hours"];
export const DEFAULT_TRAIL_HOURS: TrailHours = 24;

/** How long playback rests on each fix. */
export const PLAYBACK_INTERVAL_MS = 700;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The API's FeatureCollection as points in time order. Malformed features are skipped. */
export function parseTrail(collection: unknown): TrailPoint[] {
  if (typeof collection !== "object" || collection === null) return [];
  const features = (collection as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];

  const points: TrailPoint[] = [];
  for (const f of features) {
    const geometry = (f as { geometry?: { coordinates?: unknown } })?.geometry;
    const props = (f as { properties?: Record<string, unknown> })?.properties ?? {};
    const c = geometry?.coordinates;
    if (!Array.isArray(c) || !num(c[0]) || !num(c[1])) continue;
    if (typeof props.fixed_at !== "string" || Number.isNaN(Date.parse(props.fixed_at))) continue;
    points.push({
      id: num(props.id) ? props.id : points.length,
      lon: c[0],
      lat: c[1],
      fixedAt: props.fixed_at,
      speedKmh: num(props.speed_kmh) ? props.speed_kmh : null,
      batteryPct: num(props.battery_pct) ? props.battery_pct : null,
    });
  }
  return points.sort((a, b) => Date.parse(a.fixedAt) - Date.parse(b.fixedAt) || a.id - b.id);
}

export function trailPath(points: readonly TrailPoint[]): Array<{ lat: number; lng: number }> {
  return points.map((p) => ({ lat: p.lat, lng: p.lon }));
}

export function trailBounds(points: readonly TrailPoint[]): Bounds | null {
  return boundsOfPositions(points.map((p): Position => [p.lon, p.lat]));
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(Math.round(index), 0), length - 1);
}

/** Next index for playback; `null` once the last fix has been shown. */
export function nextPlaybackIndex(index: number, length: number): number | null {
  return index + 1 < length ? index + 1 : null;
}

/** "12 / 48": which fix the playhead is on. */
export function positionLabel(index: number, length: number): string {
  return length === 0 ? "0 / 0" : `${clampIndex(index, length) + 1} / ${length}`;
}

/** Whole minutes between two fixes, for the "gap" note (gaps are real and worth showing). */
export function gapMinutes(a: TrailPoint | undefined, b: TrailPoint | undefined): number | null {
  if (!a || !b) return null;
  return Math.round(Math.abs(Date.parse(b.fixedAt) - Date.parse(a.fixedAt)) / 60_000);
}

/** The point playback is on, or null for an empty trail. */
export function pointAt(points: readonly TrailPoint[], index: number): TrailPoint | null {
  return points.length === 0 ? null : points[clampIndex(index, points.length)];
}
