/**
 * The REAL terra-draw (polygon, circle and select modes, built exactly as the app builds them in
 * src/components/map/drawModes.ts) driven through a minimal test adapter, with its output fed to
 * the functions that turn a drawn shape into the geofence API request.
 *
 * What this proves: terra-draw produces the geometry and properties our code expects, accepts the
 * features we load for editing, and reports an edit as a feature our payload code understands.
 * What it cannot prove: the Google Maps adapter itself (it needs a map with a valid key).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TerraDraw } from "terra-draw";
import { buildDrawModes } from "../src/components/map/drawModes";
import { drawnFromSaved, payloadFromDrawn, type DrawnFeature } from "../src/lib/maps/fences";
import { circleRing, haversineM, type Position } from "../src/lib/maps/geo";

/** Pixels per degree: big enough that terra-draw's pixel tolerances never confuse two points. */
const PX = 20_000;

/** Just enough of an adapter for terra-draw: a flat projection and a way to send pointer events. */
class TestAdapter {
  // The callbacks terra-draw registers (onClick, onMouseMove, onDrag...), driven by the helpers below.
  callbacks: Record<string, (...args: unknown[]) => void> = {};
  project = (lng: number, lat: number) => ({ x: lng * PX, y: -lat * PX });
  unproject = (x: number, y: number) => ({ lng: x / PX, lat: -y / PX });
  setCursor = () => {};
  getLngLatFromEvent = () => null;
  setDoubleClickToZoom = () => {};
  getMapEventElement = () => ({}) as HTMLElement;
  register(callbacks: TestAdapter["callbacks"]) { this.callbacks = callbacks; }
  unregister() { this.callbacks = {}; }
  render() {}
  clear() {}
  getCoordinatePrecision = () => 9;

  private event(lng: number, lat: number) {
    return { lng, lat, containerX: lng * PX, containerY: -lat * PX, button: "left" as const, heldKeys: [] as string[], isContextMenu: false };
  }
  move(lng: number, lat: number) { this.callbacks.onMouseMove(this.event(lng, lat)); }
  click(lng: number, lat: number) { this.move(lng, lat); this.callbacks.onClick(this.event(lng, lat)); }
  key(key: string) { this.callbacks.onKeyUp({ key, heldKeys: [], preventDefault() {} }); }
  drag(from: Position, to: Position) {
    const noop = () => {};
    this.callbacks.onDragStart(this.event(from[0], from[1]), noop);
    this.callbacks.onDrag(this.event((from[0] + to[0]) / 2, (from[1] + to[1]) / 2), noop);
    this.callbacks.onDrag(this.event(to[0], to[1]), noop);
    this.callbacks.onDragEnd(this.event(to[0], to[1]), noop);
  }
}

const COLORS = { brand: "#c1502e", highlight: "#d9a441", charcoal: "#2b2a28" } as const;
const LAHORE: Position = [74.3587, 31.5204];

interface Finish { id: string | number; mode: string; action: string }
let adapter: TestAdapter;
let draw: TerraDraw;
let finished: Finish[];

beforeEach(() => {
  adapter = new TestAdapter();
  draw = new TerraDraw({ adapter: adapter as never, modes: buildDrawModes(COLORS) });
  finished = [];
  draw.on("finish", (id, context) => finished.push({ id, mode: context.mode, action: context.action }));
  draw.start();
});

const snapshot = () => draw.getSnapshot() as unknown as DrawnFeature[];

describe("drawing a polygon", () => {
  it("click the corners, press Enter: one polygon, which becomes the polygon payload", () => {
    draw.setMode("polygon");
    const corners: Position[] = [[74.30, 31.50], [74.40, 31.50], [74.40, 31.58], [74.30, 31.58]];
    for (const [lng, lat] of corners) adapter.click(lng, lat);
    adapter.key("Enter");

    expect(finished).toEqual([expect.objectContaining({ mode: "polygon", action: "draw" })]);
    const [feature] = snapshot();
    expect(feature.geometry.type).toBe("Polygon");
    const r = payloadFromDrawn(feature);
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.type !== "polygon") throw new Error("expected a polygon payload");
    const ring = r.value.geojson.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed, as PostGIS needs
    expect(new Set(ring.slice(0, -1).map((p) => p.join())).size).toBe(4);
  });

  it("two clicks are not a polygon: nothing is finished, so nothing is reported", () => {
    draw.setMode("polygon");
    adapter.click(74.3, 31.5);
    adapter.click(74.4, 31.5);
    adapter.key("Enter");
    expect(finished).toEqual([]); // the editor only reacts to a finished shape
    expect(snapshot().every((f) => f.properties?.currentlyDrawing === true)).toBe(true);
  });
});

describe("drawing a circle", () => {
  it("click the centre, move out, click: a circle feature, which becomes centre and radius", () => {
    draw.setMode("circle");
    adapter.click(LAHORE[0], LAHORE[1]);
    const edge: Position = [LAHORE[0] + 0.02, LAHORE[1]];
    adapter.move(edge[0], edge[1]);
    adapter.click(edge[0], edge[1]);

    expect(finished).toEqual([expect.objectContaining({ mode: "circle", action: "draw" })]);
    const [feature] = snapshot();
    expect(feature.properties?.mode).toBe("circle");
    expect(feature.geometry.type).toBe("Polygon");

    const r = payloadFromDrawn(feature);
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.type !== "radius") throw new Error("expected a radius payload");
    const expected = haversineM(LAHORE, edge);
    expect(Math.abs(r.value.radius_m - expected)).toBeLessThan(expected * 0.02);
    expect(Math.abs(r.value.center_lat - LAHORE[1])).toBeLessThan(0.001);
    expect(Math.abs(r.value.center_lon - LAHORE[0])).toBeLessThan(0.001);
  });
});

describe("editing a saved fence", () => {
  it("terra-draw accepts a saved polygon fence as an editable shape", () => {
    const f = drawnFromSaved({
      type: "polygon", center_lat: null, center_lon: null, radius_m: null,
      geometry: { type: "Polygon", coordinates: [[[74.30, 31.50], [74.40, 31.50], [74.40, 31.58], [74.30, 31.58], [74.30, 31.50]]] },
    });
    expect(f).not.toBeNull();
    const results = draw.addFeatures([f as never]);
    expect(results.every((r) => r.valid)).toBe(true);
    draw.setMode("select");
    draw.selectFeature(snapshot()[0].geometry && (draw.getSnapshot()[0].id as string));
    expect(draw.getSnapshot().some((x) => (x.properties as { selected?: boolean }).selected)).toBe(true);
  });

  it("dragging a corner is reported as an edit, and the new payload has the moved corner", () => {
    const start: Position[] = [[74.30, 31.50], [74.40, 31.50], [74.40, 31.58], [74.30, 31.58]];
    const f = drawnFromSaved({
      type: "polygon", center_lat: null, center_lon: null, radius_m: null,
      geometry: { type: "Polygon", coordinates: [[...start, start[0]]] },
    });
    draw.addFeatures([f as never]);
    draw.setMode("select");
    const id = draw.getSnapshot()[0].id as string;
    draw.selectFeature(id);

    adapter.drag([74.40, 31.58], [74.45, 31.62]);

    expect(finished.some((x) => x.action !== "draw")).toBe(true); // an edit, not a new drawing
    const edited = draw.getSnapshotFeature(id) as unknown as DrawnFeature;
    const r = payloadFromDrawn(edited);
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.type !== "polygon") throw new Error("expected a polygon payload");
    const corners = r.value.geojson.coordinates[0].map((p) => p.join(","));
    expect(corners).toContain("74.45,31.62");
    expect(corners).not.toContain("74.4,31.58");
  });

  it("a saved radius fence loads as a circle with the same centre and radius", () => {
    const f = drawnFromSaved({ type: "radius", geometry: null, center_lat: 31.52, center_lon: 74.36, radius_m: 2500 });
    const results = draw.addFeatures([f as never]);
    expect(results.every((r) => r.valid)).toBe(true);
    const back = payloadFromDrawn(snapshot()[0]);
    expect(back.ok).toBe(true);
    if (!back.ok || back.value.type !== "radius") throw new Error("expected radius");
    expect(Math.abs(back.value.radius_m - 2500)).toBeLessThan(25);
    expect(back.value.center_lat).toBeCloseTo(31.52, 3);
    expect(back.value.center_lon).toBeCloseTo(74.36, 3);
  });

  it("dragging the edge of a circle resizes it (centre stays put)", () => {
    const center: Position = [74.36, 31.52];
    const f = drawnFromSaved({ type: "radius", geometry: null, center_lat: center[1], center_lon: center[0], radius_m: 2000 });
    draw.addFeatures([f as never]);
    draw.setMode("select");
    const id = draw.getSnapshot()[0].id as string;
    draw.selectFeature(id);

    const ring = circleRing(center, 2000);
    const east = ring[16]; // a vertex on the edge (bearing 90 degrees)
    const farther = [center[0] + (east[0] - center[0]) * 2, east[1]] as Position;
    adapter.drag(east, farther);

    const after = payloadFromDrawn(draw.getSnapshotFeature(id) as unknown as DrawnFeature);
    expect(after.ok).toBe(true);
    if (!after.ok || after.value.type !== "radius") throw new Error("expected radius");
    expect(after.value.radius_m).toBeGreaterThan(3000); // grew from 2000 m
    expect(Math.abs(after.value.center_lat - center[1])).toBeLessThan(0.01);
    expect(Math.abs(after.value.center_lon - center[0])).toBeLessThan(0.01);
  });
});
