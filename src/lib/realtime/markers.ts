/**
 * Applying live changes to the map's marker list. Pure, so it is unit-tested
 * (tests/realtime-markers.test.ts): the map itself is a canvas and cannot be inspected from outside.
 */
import type { LiveFix } from "./events";

/** The parts of a marker (GeoJSON feature) that live changes touch. */
export interface PatchableMarker {
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: number;
    status: string;
    fixed_at: string;
    battery_pct: number | null;
  };
}

/**
 * Apply the newest fix and the latest status per animal. A fix older than what the marker already
 * shows is ignored, so a late or replayed fix can never move an animal backwards. Markers that are
 * not mentioned are returned untouched (same object), and when nothing changes the SAME array is
 * returned, so React does not redraw the map.
 */
export function applyLiveToMarkers<M extends PatchableMarker>(
  markers: M[],
  fixes: ReadonlyMap<number, LiveFix>,
  statuses: ReadonlyMap<number, string>,
): M[] {
  let changed = false;
  const next = markers.map((m) => {
    const id = m.properties.id;
    const fix = fixes.get(id);
    const status = statuses.get(id);

    const newer = fix !== undefined && !(m.properties.fixed_at && Date.parse(m.properties.fixed_at) > Date.parse(fix.fixedAt));
    const statusChanged = status !== undefined && status !== m.properties.status;
    if (!newer && !statusChanged) return m;

    changed = true;
    return {
      ...m,
      geometry: newer ? { type: "Point" as const, coordinates: [fix.lon, fix.lat] as [number, number] } : m.geometry,
      properties: {
        ...m.properties,
        fixed_at: newer ? fix.fixedAt : m.properties.fixed_at,
        battery_pct: newer && fix.batteryPct !== null ? fix.batteryPct : m.properties.battery_pct,
        status: status ?? m.properties.status,
      },
    };
  });
  return changed ? next : markers;
}
