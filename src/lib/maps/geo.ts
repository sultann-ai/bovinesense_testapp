/**
 * Small geometry helpers for the map. Pure and client-safe. Coordinates are GeoJSON order
 * ([longitude, latitude]) everywhere in this module.
 *
 * (Authoritative decisions, such as whether an animal is outside its fence, are made in Postgres
 * with PostGIS, never here; these helpers only draw and measure for the screen.)
 */
import type { Bounds } from "./regions";

export type Position = [number, number];
export type Ring = Position[];

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres. */
export function haversineM(a: Position, b: Position): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point `distanceM` from `origin` along `bearingDeg` (0 = north, clockwise). */
export function destination(origin: Position, distanceM: number, bearingDeg: number): Position {
  const d = distanceM / EARTH_RADIUS_M;
  const brg = rad(bearingDeg);
  const lat1 = rad(origin[1]);
  const lon1 = rad(origin[0]);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [((deg(lon2) + 540) % 360) - 180, deg(lat2)];
}

/**
 * The precision terra-draw stores coordinates at (and the Google Maps adapter is configured with).
 * It REFUSES a feature with more decimals than this, so every shape handed to the editor is rounded.
 */
export const DRAW_PRECISION = 9;

export function roundPosition(p: Position, decimals = DRAW_PRECISION): Position {
  const f = 10 ** decimals;
  return [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
}

export function roundRing(ring: Ring, decimals = DRAW_PRECISION): Ring {
  return ring.map((p) => roundPosition(p, decimals));
}

/** A closed ring approximating a circle, `segments` points around, at the editor's precision. */
export function circleRing(center: Position, radiusM: number, segments = 64): Ring {
  const ring: Ring = [];
  for (let i = 0; i < segments; i++) ring.push(roundPosition(destination(center, radiusM, (360 * i) / segments)));
  ring.push([...ring[0]] as Position);
  return ring;
}

/** The centre and radius of a ring that is (approximately) a circle. */
export function circleFromRing(ring: Ring): { center: Position; radiusM: number } | null {
  const pts = closedRingPoints(ring);
  if (pts.length < 3) return null;
  const b = boundsOfPositions(pts);
  if (!b) return null;
  const center: Position = [(b.west + b.east) / 2, (b.south + b.north) / 2];
  const radiusM = pts.reduce((sum, p) => sum + haversineM(center, p), 0) / pts.length;
  return { center, radiusM };
}

function closedRingPoints(ring: Ring): Ring {
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) {
    return ring.slice(0, -1);
  }
  return ring;
}

export function boundsOfPositions(points: readonly Position[]): Bounds | null {
  if (points.length === 0) return null;
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const [lon, lat] of points) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  return south === Infinity ? null : { south, west, north, east };
}

/** Widen bounds by a fraction of their size, so pins at the edge are not clipped. */
export function padBounds(b: Bounds, fraction: number, minDegrees = 0.002): Bounds {
  const dLat = Math.max((b.north - b.south) * fraction, minDegrees);
  const dLon = Math.max((b.east - b.west) * fraction, minDegrees);
  return { south: b.south - dLat, north: b.north + dLat, west: b.west - dLon, east: b.east + dLon };
}

export interface PolygonalGeometry {
  type: string;
  coordinates?: unknown;
}

/** Every ring of a Polygon or MultiPolygon (outer rings and holes), or none for anything else. */
export function ringsOf(geometry: PolygonalGeometry | null | undefined): Ring[] {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const isRing = (v: unknown): v is Ring =>
    Array.isArray(v) && v.length > 0 && Array.isArray(v[0]) && typeof (v[0] as unknown[])[0] === "number";
  if (geometry.type === "Polygon") {
    return (geometry.coordinates as unknown[]).filter(isRing) as Ring[];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as unknown[][]).flatMap((poly) => (Array.isArray(poly) ? (poly.filter(isRing) as Ring[]) : []));
  }
  return [];
}

export function boundsOfGeometry(geometry: PolygonalGeometry | null | undefined): Bounds | null {
  return boundsOfPositions(ringsOf(geometry).flat());
}

export function centerOfBounds(b: Bounds): Position {
  return [(b.west + b.east) / 2, (b.south + b.north) / 2];
}

function perpendicularDistance(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + tc * dx), p[1] - (a[1] + tc * dy));
}

/**
 * Douglas-Peucker: drop points that deviate less than `toleranceDeg` from the simplified line. Keeps
 * the first and last point (a closed ring stays closed) and never returns fewer than 4 points for a
 * ring that had them. Used so a detailed district boundary stays cheap to draw.
 */
export function simplifyRing(ring: Ring, toleranceDeg: number): Ring {
  if (ring.length <= 4 || toleranceDeg <= 0) return ring;
  const keep = new Array<boolean>(ring.length).fill(false);
  keep[0] = keep[ring.length - 1] = true;
  const stack: Array<[number, number]> = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(ring[i], ring[first], ring[last]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (index !== -1 && maxDist > toleranceDeg) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

export function vertexCount(geometry: PolygonalGeometry | null | undefined): number {
  return ringsOf(geometry).reduce((n, r) => n + r.length, 0);
}
