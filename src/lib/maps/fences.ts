/**
 * Turning what terra-draw draws into what the API saves, and a saved fence back into something the
 * editor can pick up. Pure and client-safe.
 *
 * The map draws two kinds of custom shape and the database stores both as PostGIS geometry:
 *   polygon  -> { type: "polygon", geojson }                       the polygon as drawn
 *   circle   -> { type: "radius", center_lat, center_lon, radius_m }   the database builds the circle
 * A district fence follows its district's boundary and has nothing to draw or reshape.
 */
import { circleFromRing, circleRing, ringsOf, roundRing, type Position, type Ring } from "./geo";

export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 100_000;
export const MIN_BUFFER_M = 50;
export const MAX_BUFFER_M = 5000;
/** Fewer decimals than this are visibly coarse; more are noise (6 decimals is about 0.1 m). */
const COORD_DECIMALS = 6;

export type FenceType = "district" | "polygon" | "radius";

/** The slice of a terra-draw feature this module reads. */
export interface DrawnFeature {
  geometry: { type: string; coordinates?: unknown };
  properties?: Record<string, unknown> | null;
}

export type ShapePayload =
  | { type: "polygon"; geojson: { type: "Polygon"; coordinates: Ring[] } }
  | { type: "radius"; center_lat: number; center_lon: number; radius_m: number };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const round = (n: number, d = COORD_DECIMALS) => Math.round(n * 10 ** d) / 10 ** d;

/** The kind of shape terra-draw drew. */
export function drawnKind(feature: DrawnFeature): "polygon" | "circle" | null {
  if (feature.properties?.mode === "circle") return "circle";
  if (feature.geometry.type === "Polygon") return "polygon";
  return null;
}

/** A terra-draw feature, as the payload that creates or reshapes a fence. */
export function payloadFromDrawn(feature: DrawnFeature): Result<ShapePayload> {
  const kind = drawnKind(feature);
  const ring = ringsOf(feature.geometry)[0];
  if (!kind || !ring) return { ok: false, error: "Draw a polygon or a circle." };

  if (kind === "circle") {
    const c = circleFromRing(ring);
    if (!c) return { ok: false, error: "The circle is too small." };
    const radius = Math.round(c.radiusM);
    if (radius < MIN_RADIUS_M) return { ok: false, error: `The radius must be at least ${MIN_RADIUS_M} m.` };
    if (radius > MAX_RADIUS_M) return { ok: false, error: "The radius can be at most 100 km." };
    return { ok: true, value: { type: "radius", center_lat: round(c.center[1]), center_lon: round(c.center[0]), radius_m: radius } };
  }

  const distinct = new Set(ring.slice(0, -1).map((p) => `${p[0]},${p[1]}`));
  if (distinct.size < 3) return { ok: false, error: "A polygon needs at least three corners." };
  const rounded = ring.map((p) => [round(p[0]), round(p[1])] as Position);
  return { ok: true, value: { type: "polygon", geojson: { type: "Polygon", coordinates: [rounded] } } };
}

/** A radius given as numbers (centre and metres), as the same payload the drawn circle produces. */
export function payloadFromRadius(lat: number, lon: number, radiusM: number): Result<ShapePayload> {
  if (![lat, lon, radiusM].every(Number.isFinite)) return { ok: false, error: "Enter the centre and the radius." };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { ok: false, error: "The centre is not a valid coordinate." };
  if (radiusM < MIN_RADIUS_M) return { ok: false, error: `The radius must be at least ${MIN_RADIUS_M} m.` };
  if (radiusM > MAX_RADIUS_M) return { ok: false, error: "The radius can be at most 100 km." };
  return { ok: true, value: { type: "radius", center_lat: round(lat), center_lon: round(lon), radius_m: Math.round(radiusM) } };
}

/** What the editor needs to know about a saved fence. */
export interface SavedFence {
  type: FenceType;
  geometry: { type: string; coordinates?: unknown } | null;
  center_lat: number | null;
  center_lon: number | null;
  radius_m: number | null;
}

/** A terra-draw feature for a saved fence, or null when it cannot be edited on the map. */
export function drawnFromSaved(fence: SavedFence): { type: "Feature"; geometry: { type: "Polygon"; coordinates: Ring[] }; properties: Record<string, unknown> } | null {
  if (fence.type === "district") return null; // follows its district boundary

  if (fence.type === "radius") {
    let center: Position | null = null;
    let radiusM = fence.radius_m;
    if (fence.center_lat !== null && fence.center_lon !== null && radiusM !== null) {
      center = [fence.center_lon, fence.center_lat];
    } else {
      // A fence saved before the centre was kept: read it off the outline.
      const ring = ringsOf(fence.geometry)[0];
      const c = ring ? circleFromRing(ring) : null;
      if (c) { center = c.center; radiusM = c.radiusM; }
    }
    if (!center || radiusM === null) return null;
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [circleRing(center, radiusM)] },
      properties: { mode: "circle", radiusKilometers: radiusM / 1000 },
    };
  }

  // A polygon fence. Only a single plain polygon can be edited vertex by vertex.
  const g = fence.geometry;
  if (!g || g.type !== "Polygon" || !Array.isArray(g.coordinates)) return null;
  const rings = (g.coordinates as Ring[]).map((r) => roundRing(r)); // terra-draw refuses excess precision
  return { type: "Feature", geometry: { type: "Polygon", coordinates: rings }, properties: { mode: "polygon" } };
}

/** The fields of the edit request that change the shape, for the fence's type. */
export function reshapeFields(type: FenceType, payload: ShapePayload): Result<Record<string, unknown>> {
  if (type === "polygon" && payload.type === "polygon") return { ok: true, value: { geojson: payload.geojson } };
  if (type === "radius" && payload.type === "radius") {
    return { ok: true, value: { center_lat: payload.center_lat, center_lon: payload.center_lon, radius_m: payload.radius_m } };
  }
  return { ok: false, error: type === "district" ? "A district fence cannot be reshaped." : "That shape does not fit this kind of fence." };
}
