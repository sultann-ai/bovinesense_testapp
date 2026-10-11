// @vitest-environment jsdom
/**
 * AnimalMarkerLayer with the REAL @googlemaps/markerclusterer (and its real supercluster) over a
 * fake map (tests/helpers/fake-google.ts): what gets clustered at which zoom, what a cluster looks
 * like, and that live changes (a status flip, a move, an animal appearing or leaving) are reflected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { installFakeGoogle, type FakeAdvancedMarker, type FakeGoogle, type FakeMap } from "./helpers/fake-google";

const harness = vi.hoisted(() => ({ map: null as unknown, libs: {} as Record<string, unknown> }));
vi.mock("@vis.gl/react-google-maps", () => ({
  useMap: () => harness.map,
  useMapsLibrary: (name: string) => harness.libs[name] ?? null,
}));

import { AnimalMarkerLayer, type PinData } from "../src/components/map/AnimalMarkerLayer";

let g: FakeGoogle;
let map: FakeMap;

const pin = (id: number, lat: number, lon: number, over: Partial<PinData> = {}): PinData => ({
  id, lat, lon, status: "inside", tagSerial: `SIM-${id}`, animalName: `Animal ${id}`, hasUnackBreach: false, ...over,
});
const LAHORE = pin(1, 31.5204, 74.3587);
const FAISALABAD = pin(2, 31.4504, 73.0479, { status: "breach", hasUnackBreach: true });
const MULTAN = pin(3, 30.1575, 71.5249);

const isCluster = (m: FakeAdvancedMarker) => m.content?.classList.contains("bs-cluster") ?? false;
const isPin = (m: FakeAdvancedMarker) => m.content?.classList.contains("bs-pin") ?? false;
/** The markers currently on the map. */
const onMap = () => g.markers.filter((m) => m.map !== null);
const visibleClusters = () => onMap().filter(isCluster);
const visiblePins = () => onMap().filter(isPin);
const pinFor = (id: number) => g.markers.find((m) => isPin(m) && m.title?.includes(`SIM-${id}`))!;

beforeEach(() => {
  // The clusterer takes a replaced cluster off the map one animation frame after drawing its
  // successor (so nothing flickers). Run frames at once so a test sees the settled map.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
  g = installFakeGoogle();
  map = new g.Map();
  harness.map = map;
  harness.libs = { marker: { AdvancedMarkerElement: g.AdvancedMarkerElement } };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(pins: PinData[], over: { selectedId?: number | null; onSelect?: (id: number) => void } = {}) {
  const props = { pins, selectedId: over.selectedId ?? null, onSelect: over.onSelect ?? (() => {}) };
  const view = render(<AnimalMarkerLayer {...props} />);
  return {
    update: (next: Partial<typeof props>) => view.rerender(<AnimalMarkerLayer {...{ ...props, ...next }} />),
    unmount: view.unmount,
  };
}

describe("below zoom 10 animals cluster; from zoom 10 each is its own pin", () => {
  it("zoomed in (10): every animal is a pin on the map, nothing is clustered", () => {
    map.zoom = 10;
    mount([LAHORE, FAISALABAD, MULTAN]);
    expect(visiblePins()).toHaveLength(3);
    expect(visibleClusters()).toHaveLength(0);
  });

  it("zoomed out (5): neighbouring animals merge into a cluster, a distant one stays a pin", () => {
    map.zoom = 5;
    mount([LAHORE, FAISALABAD, MULTAN]);
    expect(visibleClusters()).toHaveLength(1);
    expect(visibleClusters()[0].content?.querySelector(".bs-cluster__count")?.textContent).toBe("2");
    expect(visiblePins().map((m) => m.title)).toEqual([expect.stringContaining("SIM-3")]);
  });

  it("zooming in past the limit breaks the cluster apart (on the map's next idle)", () => {
    map.zoom = 5;
    mount([LAHORE, FAISALABAD, MULTAN]);
    expect(visibleClusters()).toHaveLength(1);
    map.zoom = 10;
    map.emit("idle");
    expect(visibleClusters()).toHaveLength(0);
    expect(visiblePins()).toHaveLength(3);
  });
});

describe("a cluster containing a breach is marked, so a breach never hides", () => {
  it("gets the crimson-ring flag, a badge with the breach count and the highest z-order", () => {
    map.zoom = 5;
    mount([LAHORE, FAISALABAD, MULTAN]);
    const [cluster] = visibleClusters();
    expect(cluster.content?.dataset.breach).toBe("true");
    expect(cluster.content?.querySelector(".bs-cluster__breaches")?.textContent).toBe("1");
    expect(cluster.title).toBe("2 animals, 1 in breach");
    expect(cluster.zIndex).toBe(600);
  });

  it("counts every breach inside, not just whether there is one", () => {
    map.zoom = 3;
    mount([LAHORE, FAISALABAD, { ...MULTAN, status: "breach", hasUnackBreach: false }]);
    const [cluster] = visibleClusters();
    expect(cluster.content?.querySelector(".bs-cluster__count")?.textContent).toBe("3");
    expect(cluster.content?.querySelector(".bs-cluster__breaches")?.textContent).toBe("2");
  });

  it("a cluster with no breach has no flag and sits below breach clusters", () => {
    map.zoom = 5;
    mount([LAHORE, { ...FAISALABAD, status: "inside", hasUnackBreach: false }, MULTAN]);
    const [cluster] = visibleClusters();
    expect(cluster.content?.dataset.breach).toBe("false");
    expect(cluster.zIndex).toBe(500);
  });

  it("a breach appearing inside an existing cluster updates its badge at once", () => {
    map.zoom = 5;
    const view = mount([LAHORE, { ...FAISALABAD, status: "inside", hasUnackBreach: false }, MULTAN]);
    expect(visibleClusters()[0].content?.dataset.breach).toBe("false");
    view.update({ pins: [LAHORE, FAISALABAD, MULTAN] });
    expect(visibleClusters()).toHaveLength(1);
    expect(visibleClusters()[0].content?.dataset.breach).toBe("true");
  });

  it("and clears when the breach is resolved", () => {
    map.zoom = 5;
    const view = mount([LAHORE, FAISALABAD, MULTAN]);
    view.update({ pins: [LAHORE, { ...FAISALABAD, status: "inside", hasUnackBreach: false }, MULTAN] });
    expect(visibleClusters()[0].content?.dataset.breach).toBe("false");
  });
});

describe("live changes", () => {
  it("an animal that MOVES is re-clustered at its new position (not left in its old cluster)", () => {
    map.zoom = 5;
    const view = mount([LAHORE, FAISALABAD, MULTAN]);
    expect(visibleClusters()[0].content?.querySelector(".bs-cluster__count")?.textContent).toBe("2");

    // Multan's animal walks to Lahore: all three are now together
    view.update({ pins: [LAHORE, FAISALABAD, { ...MULTAN, lat: 31.52, lon: 74.36 }] });
    expect(visibleClusters()).toHaveLength(1);
    expect(visibleClusters()[0].content?.querySelector(".bs-cluster__count")?.textContent).toBe("3");
    expect(visiblePins()).toHaveLength(0);
  });

  it("and leaves a cluster when it moves away from it", () => {
    map.zoom = 5;
    const view = mount([LAHORE, FAISALABAD, MULTAN]);
    view.update({ pins: [LAHORE, { ...FAISALABAD, lat: 25.0, lon: 67.0 }, MULTAN] }); // Faisalabad's animal to Karachi
    expect(visibleClusters()).toHaveLength(0);
    expect(visiblePins()).toHaveLength(3);
  });

  it("moves an existing marker instead of creating a new one", () => {
    map.zoom = 10;
    const view = mount([LAHORE]);
    const before = g.markers.length;
    view.update({ pins: [{ ...LAHORE, lat: 31.6, lon: 74.4 }] });
    expect(g.markers.length).toBe(before);
    expect(pinFor(1).position).toEqual({ lat: 31.6, lng: 74.4 });
  });

  it("an animal that appears gets a pin, and one that goes is taken off the map", () => {
    map.zoom = 10;
    const view = mount([LAHORE, MULTAN]);
    view.update({ pins: [LAHORE, MULTAN, FAISALABAD] });
    expect(visiblePins()).toHaveLength(3);
    view.update({ pins: [LAHORE] });
    expect(visiblePins()).toHaveLength(1);
    expect(pinFor(3).map).toBeNull();
  });

  it("a status change restyles the pin without rebuilding it", () => {
    map.zoom = 10;
    const view = mount([LAHORE]);
    const content = pinFor(1).content!;
    view.update({ pins: [{ ...LAHORE, status: "stale" }] });
    expect(pinFor(1).content).toBe(content);
    expect(content.dataset).toMatchObject({ status: "stale", stale: "true" });
  });
});

describe("pins", () => {
  it("carry their status, in words, and the pulse only for an unacknowledged breach", () => {
    map.zoom = 10;
    mount([LAHORE, FAISALABAD]);
    expect(pinFor(1).content?.dataset).toMatchObject({ status: "inside", pulse: "false" });
    expect(pinFor(2).content?.dataset).toMatchObject({ status: "breach", pulse: "true" });
    expect(pinFor(2).title).toBe("SIM-2 · Animal 2: Breach (not acknowledged)");
  });

  it("the selected animal gets the gold ring state and the top z-order", () => {
    map.zoom = 10;
    const view = mount([LAHORE, FAISALABAD]);
    expect(pinFor(1).content?.dataset.selected).toBe("false");
    view.update({ selectedId: 1 });
    expect(pinFor(1).content?.dataset.selected).toBe("true");
    expect(pinFor(1).zIndex).toBe(1000);
    view.update({ selectedId: 2 });
    expect(pinFor(1).content?.dataset.selected).toBe("false");
    expect(pinFor(2).content?.dataset.selected).toBe("true");
  });

  it("are clickable, and a click selects that animal (whichever click event Google fires)", () => {
    map.zoom = 10;
    const onSelect = vi.fn();
    mount([LAHORE, FAISALABAD], { onSelect });
    expect(pinFor(2).gmpClickable).toBe(true);
    pinFor(2).fire("gmp-click");
    pinFor(1).fire("click");
    expect(onSelect.mock.calls).toEqual([[2], [1]]);
  });

  it("always call the latest onSelect", () => {
    map.zoom = 10;
    const first = vi.fn();
    const second = vi.fn();
    const view = mount([LAHORE], { onSelect: first });
    view.update({ onSelect: second });
    pinFor(1).fire("gmp-click");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(1);
  });
});

describe("lifecycle", () => {
  it("does nothing until the map and the marker library are ready", () => {
    harness.map = null;
    mount([LAHORE]);
    expect(g.markers).toHaveLength(0);
  });

  it("unmounting takes every marker, pin and cluster, off the map", () => {
    map.zoom = 5;
    const view = mount([LAHORE, FAISALABAD, MULTAN]);
    expect(onMap().length).toBeGreaterThan(0);
    view.unmount();
    expect(onMap()).toHaveLength(0);
  });

  it("copes with a large fleet (1000 animals) in one render", () => {
    map.zoom = 8;
    const fleet = Array.from({ length: 1000 }, (_, i) => pin(100 + i, 30 + (i % 40) * 0.1, 70 + Math.floor(i / 40) * 0.1));
    const t0 = performance.now();
    mount(fleet);
    expect(performance.now() - t0).toBeLessThan(5000);
    const total = visiblePins().length + visibleClusters().reduce((n, c) => n + Number(c.content?.querySelector(".bs-cluster__count")?.textContent), 0);
    expect(total).toBe(1000); // every animal is either a pin or counted in a cluster
  });
});
