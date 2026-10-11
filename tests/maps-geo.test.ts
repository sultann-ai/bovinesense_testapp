import { describe, expect, it } from "vitest";
import {
  boundsOfGeometry, boundsOfPositions, centerOfBounds, circleFromRing, circleRing, destination,
  haversineM, padBounds, ringsOf, simplifyRing, vertexCount, type Position, type Ring,
} from "../src/lib/maps/geo";
import {
  drawnFromSaved, drawnKind, payloadFromDrawn, payloadFromRadius, reshapeFields, type DrawnFeature,
} from "../src/lib/maps/fences";
import {
  TRAIL_WINDOWS, clampIndex, gapMinutes, nextPlaybackIndex, parseTrail, pointAt, positionLabel,
  trailBounds, trailPath,
} from "../src/lib/maps/trail";

const LAHORE: Position = [74.3587, 31.5204];

// ─── geometry ────────────────────────────────────────────────────────────────────────────────────
describe("distance and circles", () => {
  it("measures great-circle distance (Lahore to Faisalabad is about 109 km)", () => {
    const d = haversineM(LAHORE, [73.0479, 31.4504]);
    expect(d).toBeGreaterThan(105_000);
    expect(d).toBeLessThan(125_000);
    expect(haversineM(LAHORE, LAHORE)).toBe(0);
  });

  it("destination goes the distance asked, in the direction asked", () => {
    const north = destination(LAHORE, 1000, 0);
    expect(haversineM(LAHORE, north)).toBeCloseTo(1000, 0);
    expect(north[1]).toBeGreaterThan(LAHORE[1]);
    expect(north[0]).toBeCloseTo(LAHORE[0], 5);
    const east = destination(LAHORE, 1000, 90);
    expect(east[0]).toBeGreaterThan(LAHORE[0]);
  });

  it("builds a closed ring at the right radius", () => {
    const ring = circleRing(LAHORE, 2000, 64);
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
    for (const p of ring) expect(haversineM(LAHORE, p)).toBeCloseTo(2000, 0);
  });

  it("recovers the centre and radius of a circle ring, to within a metre or so", () => {
    for (const r of [60, 500, 2000, 45_000]) {
      const c = circleFromRing(circleRing(LAHORE, r));
      expect(c).not.toBeNull();
      expect(haversineM(c!.center, LAHORE)).toBeLessThan(Math.max(1, r * 0.002));
      expect(Math.abs(c!.radiusM - r)).toBeLessThan(Math.max(1, r * 0.002));
    }
    expect(circleFromRing([])).toBeNull();
    expect(circleFromRing([[0, 0], [1, 1]])).toBeNull();
  });
});

describe("bounds and rings", () => {
  const square: Ring = [[74, 31], [75, 31], [75, 32], [74, 32], [74, 31]];

  it("finds bounds, ignoring non-finite points, and nothing for nothing", () => {
    expect(boundsOfPositions([[74, 31], [75, 32], [74.5, 31.5]])).toEqual({ south: 31, west: 74, north: 32, east: 75 });
    expect(boundsOfPositions([[Number.NaN, 1], [3, 4]])).toEqual({ south: 4, west: 3, north: 4, east: 3 });
    expect(boundsOfPositions([])).toBeNull();
    expect(boundsOfPositions([[Number.NaN, Number.NaN]])).toBeNull();
  });

  it("pads bounds so edge pins are not clipped, even for a single point", () => {
    const p = padBounds({ south: 30, west: 70, north: 32, east: 74 }, 0.1);
    expect(p).toEqual({ south: 29.8, north: 32.2, west: 69.6, east: 74.4 });
    const single = padBounds({ south: 31, west: 74, north: 31, east: 74 }, 0.1);
    expect(single.north - single.south).toBeGreaterThan(0);
  });

  it("reads the rings of a Polygon and a MultiPolygon, and none of anything else", () => {
    expect(ringsOf({ type: "Polygon", coordinates: [square] })).toEqual([square]);
    expect(ringsOf({ type: "MultiPolygon", coordinates: [[square], [square, square]] })).toHaveLength(3);
    expect(ringsOf({ type: "Point", coordinates: [1, 2] })).toEqual([]);
    expect(ringsOf({ type: "LineString", coordinates: [[1, 2], [3, 4]] })).toEqual([]);
    expect(ringsOf(null)).toEqual([]);
    expect(ringsOf({ type: "Polygon" })).toEqual([]);
    expect(ringsOf({ type: "Polygon", coordinates: "oops" })).toEqual([]);
    expect(ringsOf({ type: "Polygon", coordinates: [[]] })).toEqual([]);
  });

  it("bounds and centre of a geometry, and its vertex count", () => {
    const g = { type: "Polygon", coordinates: [square] };
    const b = boundsOfGeometry(g)!;
    expect(b).toEqual({ south: 31, west: 74, north: 32, east: 75 });
    expect(centerOfBounds(b)).toEqual([74.5, 31.5]);
    expect(vertexCount(g)).toBe(5);
    expect(boundsOfGeometry({ type: "Point" })).toBeNull();
  });
});

describe("simplifyRing", () => {
  it("drops points on a straight edge and keeps the corners", () => {
    const ring: Ring = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 3], [0, 0]];
    expect(simplifyRing(ring, 0.01)).toEqual([[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]);
  });

  it("keeps a ring closed and never leaves fewer than 4 points", () => {
    const tiny: Ring = [[0, 0], [10, 0], [10, 10], [0, 0]];
    expect(simplifyRing(tiny, 100)).toEqual(tiny);
    const out = simplifyRing(circleRing([0, 0], 5000, 200), 0.0005);
    expect(out[0]).toEqual(out[out.length - 1]);
    expect(out.length).toBeGreaterThanOrEqual(4);
  });

  it("thins a detailed boundary a lot without moving it more than the tolerance", () => {
    const wiggly: Ring = [];
    for (let i = 0; i <= 2000; i++) wiggly.push([i / 1000, Math.sin(i / 100) * 0.0001]);
    wiggly.push([2, 1], [0, 1], [0, 0]);
    const out = simplifyRing(wiggly, 0.0005);
    expect(out.length).toBeLessThan(wiggly.length / 10);
  });

  it("is a no-op for a zero tolerance or a short ring", () => {
    const ring: Ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(simplifyRing(ring, 0)).toBe(ring);
    expect(simplifyRing(ring, -1)).toBe(ring);
  });
});

// ─── drawn shapes <-> API ────────────────────────────────────────────────────────────────────────
const polygon = (ring: Ring): DrawnFeature => ({ geometry: { type: "Polygon", coordinates: [ring] }, properties: { mode: "polygon" } });
const circle = (center: Position, r: number): DrawnFeature => ({ geometry: { type: "Polygon", coordinates: [circleRing(center, r)] }, properties: { mode: "circle" } });

describe("payloadFromDrawn", () => {
  it("turns a drawn polygon into the polygon payload, rounding coordinates", () => {
    const ring: Ring = [[74.123456789, 31.1], [74.2, 31.1], [74.2, 31.2], [74.123456789, 31.1]];
    const r = payloadFromDrawn(polygon(ring));
    expect(r).toEqual({ ok: true, value: { type: "polygon", geojson: { type: "Polygon", coordinates: [[[74.123457, 31.1], [74.2, 31.1], [74.2, 31.2], [74.123457, 31.1]]] } } });
  });

  it("turns a drawn circle into centre and radius (the database builds the circle)", () => {
    const r = payloadFromDrawn(circle(LAHORE, 2000));
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.type !== "radius") throw new Error("expected radius");
    expect(r.value.center_lat).toBeCloseTo(LAHORE[1], 4);
    expect(r.value.center_lon).toBeCloseTo(LAHORE[0], 4);
    expect(Math.abs(r.value.radius_m - 2000)).toBeLessThanOrEqual(5);
    expect(Number.isInteger(r.value.radius_m)).toBe(true);
  });

  it("refuses a polygon with fewer than three corners, and no shape at all", () => {
    expect(payloadFromDrawn(polygon([[1, 1], [2, 2], [1, 1]]))).toMatchObject({ ok: false });
    expect(payloadFromDrawn(polygon([[1, 1], [1, 1], [1, 1], [1, 1]]))).toMatchObject({ ok: false });
    expect(payloadFromDrawn({ geometry: { type: "Point", coordinates: [1, 2] } })).toMatchObject({ ok: false });
    expect(payloadFromDrawn({ geometry: { type: "Polygon", coordinates: [] } })).toMatchObject({ ok: false });
  });

  it("holds a circle to 50 m to 100 km", () => {
    expect(payloadFromDrawn(circle(LAHORE, 20))).toMatchObject({ ok: false });
    expect(payloadFromDrawn(circle(LAHORE, 120_000))).toMatchObject({ ok: false });
    expect(payloadFromDrawn(circle(LAHORE, 60))).toMatchObject({ ok: true });
    expect(payloadFromDrawn(circle(LAHORE, 99_000))).toMatchObject({ ok: true });
  });

  it("tells the two kinds apart", () => {
    expect(drawnKind(circle(LAHORE, 100))).toBe("circle");
    expect(drawnKind(polygon([[0, 0], [1, 0], [1, 1], [0, 0]]))).toBe("polygon");
    expect(drawnKind({ geometry: { type: "Point" } })).toBeNull();
  });
});

describe("payloadFromRadius", () => {
  it("accepts numbers in range and rounds", () => {
    expect(payloadFromRadius(31.5200001234, 74.3587654321, 1999.6)).toEqual({
      ok: true, value: { type: "radius", center_lat: 31.52, center_lon: 74.358765, radius_m: 2000 },
    });
  });
  it("refuses a bad centre or radius", () => {
    const bad: Array<[number, number, number]> = [[Number.NaN, 74, 100], [91, 74, 100], [31, 181, 100], [31, 74, 10], [31, 74, 200_000]];
    for (const [lat, lon, r] of bad) {
      expect(payloadFromRadius(lat, lon, r), [lat, lon, r].join()).toMatchObject({ ok: false });
    }
  });
});

describe("drawnFromSaved and reshapeFields", () => {
  it("loads a polygon fence for editing", () => {
    const coords = [[[74, 31], [75, 31], [75, 32], [74, 31]]];
    const f = drawnFromSaved({ type: "polygon", geometry: { type: "Polygon", coordinates: coords }, center_lat: null, center_lon: null, radius_m: null });
    expect(f).toMatchObject({ geometry: { type: "Polygon", coordinates: coords }, properties: { mode: "polygon" } });
  });

  it("does not offer a MultiPolygon or a district for vertex editing", () => {
    expect(drawnFromSaved({ type: "polygon", geometry: { type: "MultiPolygon", coordinates: [] }, center_lat: null, center_lon: null, radius_m: null })).toBeNull();
    expect(drawnFromSaved({ type: "district", geometry: { type: "Polygon", coordinates: [] }, center_lat: null, center_lon: null, radius_m: null })).toBeNull();
    expect(drawnFromSaved({ type: "polygon", geometry: null, center_lat: null, center_lon: null, radius_m: null })).toBeNull();
  });

  it("loads a radius fence as a circle from its stored centre and radius", () => {
    const f = drawnFromSaved({ type: "radius", geometry: null, center_lat: 31.52, center_lon: 74.36, radius_m: 2500 });
    expect(f?.properties).toMatchObject({ mode: "circle", radiusKilometers: 2.5 });
    const back = payloadFromDrawn(f!);
    expect(back).toMatchObject({ ok: true, value: { type: "radius", center_lat: 31.52, center_lon: 74.36 } });
  });

  it("derives the circle from the outline for a radius fence saved before the centre was kept", () => {
    const ring = circleRing([73.0, 30.0], 1500);
    const f = drawnFromSaved({ type: "radius", geometry: { type: "Polygon", coordinates: [ring] }, center_lat: null, center_lon: null, radius_m: null });
    const back = payloadFromDrawn(f!);
    expect(back.ok && back.value.type === "radius" && Math.abs(back.value.radius_m - 1500) <= 5).toBe(true);
  });

  it("sends only the fields that fit the fence's type", () => {
    const poly = payloadFromDrawn(polygon([[0, 0], [1, 0], [1, 1], [0, 0]]));
    const rad = payloadFromRadius(31, 74, 500);
    if (!poly.ok || !rad.ok) throw new Error("setup");
    expect(reshapeFields("polygon", poly.value)).toEqual({ ok: true, value: { geojson: expect.any(Object) } });
    expect(reshapeFields("radius", rad.value)).toEqual({ ok: true, value: { center_lat: 31, center_lon: 74, radius_m: 500 } });
    expect(reshapeFields("radius", poly.value)).toMatchObject({ ok: false });
    expect(reshapeFields("polygon", rad.value)).toMatchObject({ ok: false });
    expect(reshapeFields("district", poly.value)).toMatchObject({ ok: false, error: expect.stringContaining("district") });
  });
});

// ─── trail ───────────────────────────────────────────────────────────────────────────────────────
const feature = (id: number, lon: number, lat: number, at: string, speed: number | null = null, battery: number | null = null) => ({
  type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { id, fixed_at: at, speed_kmh: speed, battery_pct: battery },
});

describe("trail", () => {
  it("offers a 24 h and a 7 day window", () => {
    expect(TRAIL_WINDOWS.map((w) => [w.hours, w.label])).toEqual([[24, "24 h"], [168, "7 days"]]);
  });

  it("parses points in time order and skips malformed features", () => {
    const pts = parseTrail({
      features: [
        feature(2, 74.2, 31.2, "2026-10-10T10:00:00Z", 3.5, 80),
        feature(1, 74.1, 31.1, "2026-10-10T09:00:00Z"),
        { type: "Feature", geometry: { type: "Point", coordinates: ["x", 1] }, properties: { fixed_at: "2026-10-10T08:00:00Z" } },
        { type: "Feature", geometry: null, properties: {} },
        feature(3, 74.3, 31.3, "not a date"),
        null,
      ],
    });
    expect(pts.map((p) => p.id)).toEqual([1, 2]);
    expect(pts[1]).toMatchObject({ lat: 31.2, lon: 74.2, speedKmh: 3.5, batteryPct: 80 });
    expect(pts[0]).toMatchObject({ speedKmh: null, batteryPct: null });
  });

  it("breaks ties by id, and copes with garbage input", () => {
    const pts = parseTrail({ features: [feature(9, 1, 1, "2026-10-10T09:00:00Z"), feature(4, 1, 1, "2026-10-10T09:00:00Z")] });
    expect(pts.map((p) => p.id)).toEqual([4, 9]);
    for (const bad of [null, undefined, 3, "x", {}, { features: "no" }]) expect(parseTrail(bad)).toEqual([]);
  });

  it("gives the path (lat/lng) and bounds of a trail", () => {
    const pts = parseTrail({ features: [feature(1, 74, 31, "2026-10-10T09:00:00Z"), feature(2, 75, 32, "2026-10-10T10:00:00Z")] });
    expect(trailPath(pts)).toEqual([{ lat: 31, lng: 74 }, { lat: 32, lng: 75 }]);
    expect(trailBounds(pts)).toEqual({ south: 31, west: 74, north: 32, east: 75 });
    expect(trailBounds([])).toBeNull();
  });

  it("clamps the playhead into the trail", () => {
    expect(clampIndex(-3, 10)).toBe(0);
    expect(clampIndex(99, 10)).toBe(9);
    expect(clampIndex(4.6, 10)).toBe(5);
    expect(clampIndex(5, 0)).toBe(0);
  });

  it("playback steps from fix to fix and stops after the last", () => {
    expect(nextPlaybackIndex(0, 3)).toBe(1);
    expect(nextPlaybackIndex(1, 3)).toBe(2);
    expect(nextPlaybackIndex(2, 3)).toBeNull();
    expect(nextPlaybackIndex(0, 0)).toBeNull();
    expect(nextPlaybackIndex(0, 1)).toBeNull();
  });

  it("labels the position as 'n / total' (1-based)", () => {
    expect(positionLabel(0, 48)).toBe("1 / 48");
    expect(positionLabel(47, 48)).toBe("48 / 48");
    expect(positionLabel(99, 48)).toBe("48 / 48");
    expect(positionLabel(0, 0)).toBe("0 / 0");
  });

  it("finds the point under the playhead and the real gap between two fixes", () => {
    const pts = parseTrail({ features: [feature(1, 1, 1, "2026-10-10T09:00:00Z"), feature(2, 1, 1, "2026-10-10T09:23:00Z")] });
    expect(pointAt(pts, 1)?.id).toBe(2);
    expect(pointAt(pts, 50)?.id).toBe(2);
    expect(pointAt([], 0)).toBeNull();
    expect(gapMinutes(pts[0], pts[1])).toBe(23);
    expect(gapMinutes(pts[1], pts[0])).toBe(23);
    expect(gapMinutes(undefined, pts[0])).toBeNull();
  });
});
