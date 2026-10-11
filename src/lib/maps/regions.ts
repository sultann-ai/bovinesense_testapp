/**
 * Where the map opens, and how far it may roam. Pure and client-safe.
 *
 * Nothing here is tied to one lender: the defaults are Punjab and Pakistan (the first tenant), and
 * an organization overrides them in its settings:
 *
 *   organizations.settings.map = {
 *     "service_area": { "south": 27.7, "west": 69.9, "north": 33.9, "east": 75.5, "label": "Punjab" },
 *     "country":      { "south": 23.6, "west": 60.9, "north": 37.1, "east": 77.8, "label": "Pakistan" }
 *   }
 *
 * The map never shows the whole world: it opens fitted to the service area, the "country" button
 * fits the country, and the camera is restricted to the country plus a margin (see mapLimit).
 */

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface LabelledBounds {
  bounds: Bounds;
  label: string;
}

export interface MapConfig {
  serviceArea: LabelledBounds;
  country: LabelledBounds;
  /** The most the camera may show: the country and the service area plus a margin. */
  limit: Bounds;
}

export const PUNJAB_BOUNDS: Bounds = { south: 27.7, west: 69.9, north: 33.9, east: 75.5 };
export const PAKISTAN_BOUNDS: Bounds = { south: 23.6, west: 60.9, north: 37.1, east: 77.8 };

export const DEFAULT_SERVICE_AREA: LabelledBounds = { bounds: PUNJAB_BOUNDS, label: "Punjab" };
export const DEFAULT_COUNTRY: LabelledBounds = { bounds: PAKISTAN_BOUNDS, label: "Pakistan" };

const LABEL_MAX = 30;
/** Fraction of the country's size kept as a margin around it. */
const LIMIT_MARGIN = 0.15;

function isBounds(v: unknown): v is Bounds {
  if (typeof v !== "object" || v === null) return false;
  const b = v as Record<string, unknown>;
  const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  if (!finite(b.south) || !finite(b.west) || !finite(b.north) || !finite(b.east)) return false;
  return (
    b.south >= -85 && b.north <= 85 && b.west >= -180 && b.east <= 180 &&
    b.south < b.north && b.west < b.east
  );
}

function labelled(raw: unknown, fallback: LabelledBounds): LabelledBounds {
  if (!isBounds(raw)) return fallback;
  const r = raw as unknown as Record<string, unknown>;
  const label = typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, LABEL_MAX) : fallback.label;
  return { bounds: { south: r.south as number, west: r.west as number, north: r.north as number, east: r.east as number }, label };
}

export function union(a: Bounds, b: Bounds): Bounds {
  return {
    south: Math.min(a.south, b.south),
    west: Math.min(a.west, b.west),
    north: Math.max(a.north, b.north),
    east: Math.max(a.east, b.east),
  };
}

export function expand(b: Bounds, fraction: number): Bounds {
  const dLat = (b.north - b.south) * fraction;
  const dLon = (b.east - b.west) * fraction;
  return {
    south: Math.max(-85, b.south - dLat),
    north: Math.min(85, b.north + dLat),
    west: Math.max(-180, b.west - dLon),
    east: Math.min(180, b.east + dLon),
  };
}

/** The camera limit for a configuration: both areas plus a margin. */
export function mapLimit(country: Bounds, serviceArea: Bounds): Bounds {
  return expand(union(country, serviceArea), LIMIT_MARGIN);
}

/** Read the tenant's map settings; any missing or invalid part falls back to the default. */
export function parseMapConfig(settings: unknown): MapConfig {
  const map =
    typeof settings === "object" && settings !== null && !Array.isArray(settings)
      ? (settings as Record<string, unknown>).map
      : undefined;
  const m = typeof map === "object" && map !== null && !Array.isArray(map) ? (map as Record<string, unknown>) : {};

  const serviceArea = labelled(m.service_area, DEFAULT_SERVICE_AREA);
  const country = labelled(m.country, DEFAULT_COUNTRY);
  return { serviceArea, country, limit: mapLimit(country.bounds, serviceArea.bounds) };
}

export const DEFAULT_MAP_CONFIG: MapConfig = parseMapConfig(undefined);
