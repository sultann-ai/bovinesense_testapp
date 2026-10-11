import { describe, expect, it } from "vitest";
import { applyLiveToMarkers, type PatchableMarker } from "../src/lib/realtime/markers";
import type { LiveFix } from "../src/lib/realtime/events";

const marker = (id: number, over: Partial<PatchableMarker["properties"]> = {}, coords: [number, number] = [74.3, 31.5]): PatchableMarker => ({
  geometry: { type: "Point", coordinates: coords },
  properties: { id, status: "inside", fixed_at: "2026-10-10T09:00:00+00:00", battery_pct: 80, ...over },
});
const fix = (animalId: number, over: Partial<LiveFix> = {}): LiveFix => ({
  id: 1, animalId, tagId: 1, lat: 31.6, lon: 74.4, fixedAt: "2026-10-10T09:05:00+00:00", speedKmh: 2, batteryPct: 70, ...over,
});

describe("applyLiveToMarkers", () => {
  it("moves a marker to the new fix and records its time and battery", () => {
    const [m] = applyLiveToMarkers([marker(1)], new Map([[1, fix(1)]]), new Map());
    expect(m.geometry.coordinates).toEqual([74.4, 31.6]); // [lon, lat]
    expect(m.properties).toMatchObject({ fixed_at: "2026-10-10T09:05:00+00:00", battery_pct: 70, status: "inside" });
  });

  it("keeps the old battery when the fix carries none", () => {
    const [m] = applyLiveToMarkers([marker(1)], new Map([[1, fix(1, { batteryPct: null })]]), new Map());
    expect(m.properties.battery_pct).toBe(80);
  });

  it("never moves an animal backwards: an older fix is ignored", () => {
    const start = [marker(1)];
    const out = applyLiveToMarkers(start, new Map([[1, fix(1, { fixedAt: "2026-10-10T08:00:00+00:00" })]]), new Map());
    expect(out).toBe(start);
  });

  it("applies a status change on its own", () => {
    const [m] = applyLiveToMarkers([marker(1)], new Map(), new Map([[1, "breach"]]));
    expect(m.properties.status).toBe("breach");
    expect(m.geometry.coordinates).toEqual([74.3, 31.5]);
  });

  it("applies a fix and a status together", () => {
    const [m] = applyLiveToMarkers([marker(1)], new Map([[1, fix(1)]]), new Map([[1, "near"]]));
    expect(m.properties.status).toBe("near");
    expect(m.geometry.coordinates).toEqual([74.4, 31.6]);
  });

  it("an older fix does not block a newer status", () => {
    const [m] = applyLiveToMarkers([marker(1)], new Map([[1, fix(1, { fixedAt: "2026-10-10T08:00:00+00:00" })]]), new Map([[1, "breach"]]));
    expect(m.properties.status).toBe("breach");
    expect(m.geometry.coordinates).toEqual([74.3, 31.5]);
  });

  it("touches only the animals mentioned (others keep their identity)", () => {
    const a = marker(1);
    const b = marker(2);
    const out = applyLiveToMarkers([a, b], new Map([[1, fix(1)]]), new Map());
    expect(out[0]).not.toBe(a);
    expect(out[1]).toBe(b);
  });

  it("returns the same array when nothing changes (no needless redraw)", () => {
    const start = [marker(1), marker(2)];
    expect(applyLiveToMarkers(start, new Map(), new Map())).toBe(start);
    expect(applyLiveToMarkers(start, new Map(), new Map([[1, "inside"]]))).toBe(start);
    expect(applyLiveToMarkers(start, new Map([[9, fix(9)]]), new Map())).toBe(start);
  });

  it("does not mutate its input", () => {
    const m = marker(1);
    const snapshot = JSON.stringify(m);
    applyLiveToMarkers([m], new Map([[1, fix(1)]]), new Map([[1, "breach"]]));
    expect(JSON.stringify(m)).toBe(snapshot);
  });

  it("applies a batch to many animals at once", () => {
    const ms = [marker(1), marker(2), marker(3)];
    const out = applyLiveToMarkers(ms, new Map([[1, fix(1)], [3, fix(3, { lat: 30, lon: 70 })]]), new Map([[2, "stale"]]));
    expect(out.map((m) => m.properties.status)).toEqual(["inside", "stale", "inside"]);
    expect(out[2].geometry.coordinates).toEqual([70, 30]);
  });
});
