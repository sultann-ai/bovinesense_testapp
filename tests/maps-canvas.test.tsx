// @vitest-environment jsdom
/**
 * MapCanvas: the options the Google Map is created with. (A real map needs a valid key, so the
 * @vis.gl Map is replaced by a recorder; what is asserted is exactly what the app asks Google for.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock("@vis.gl/react-google-maps", () => ({
  Map: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    h.props = props;
    return <div data-testid="map-recorder">{props.children}</div>;
  },
}));
vi.mock("../src/components/map/GoogleMapsProvider", () => ({ useMapId: () => "cloud-map-id" }));

import { MapCanvas } from "../src/components/map/MapCanvas";
import { MapConfigProvider } from "../src/components/map/MapConfigContext";
import { parseMapConfig, DEFAULT_MAP_CONFIG } from "../src/lib/maps/regions";

afterEach(() => { cleanup(); h.props = null; });

describe("MapCanvas options", () => {
  it("uses the Map ID, so the cloud style applies", () => {
    render(<MapCanvas />);
    expect(h.props?.mapId).toBe("cloud-map-id");
  });

  it("opens fitted to the service area, never on a world view", () => {
    render(<MapCanvas />);
    const b = DEFAULT_MAP_CONFIG.serviceArea.bounds;
    expect(h.props?.defaultBounds).toEqual({ ...b, padding: 40 });
    expect(h.props?.defaultZoom).toBeUndefined();
  });

  it("opens fitted to the TENANT's service area when they set one", () => {
    const tenant = parseMapConfig({ map: { service_area: { south: 24.8, west: 66.9, north: 25.1, east: 67.3, label: "Karachi" } } });
    render(<MapConfigProvider config={tenant}><MapCanvas /></MapConfigProvider>);
    expect(h.props?.defaultBounds).toMatchObject({ south: 24.8, west: 66.9, north: 25.1, east: 67.3 });
  });

  it("restricts the camera to the country plus a margin, strictly, with a minimum zoom", () => {
    render(<MapCanvas />);
    const r = h.props?.restriction as { latLngBounds: Record<string, number>; strictBounds: boolean };
    expect(r.strictBounds).toBe(true);
    expect(r.latLngBounds).toEqual(DEFAULT_MAP_CONFIG.limit);
    const c = DEFAULT_MAP_CONFIG.country.bounds;
    expect(r.latLngBounds.south).toBeLessThan(c.south);
    expect(r.latLngBounds.north).toBeGreaterThan(c.north);
    expect(h.props?.minZoom).toBeGreaterThanOrEqual(3);
  });

  it("shows the styled roadmap, or Google's hybrid imagery in satellite mode", () => {
    const view = render(<MapCanvas />);
    expect(h.props?.mapTypeId).toBe("roadmap");
    view.rerender(<MapCanvas satellite />);
    expect(h.props?.mapTypeId).toBe("hybrid");
    view.rerender(<MapCanvas />);
    expect(h.props?.mapTypeId).toBe("roadmap");
  });

  it("replaces Google's controls with the app's own (only zoom stays), and does not open Google's POI popups", () => {
    render(<MapCanvas />);
    expect(h.props).toMatchObject({ disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: "greedy" });
  });

  it("a still map (the drawer's mini map) cannot be dragged, zoomed or keyboard-driven", () => {
    render(<MapCanvas still center={{ lat: 31.5, lng: 74.3 }} zoom={14} />);
    expect(h.props).toMatchObject({ gestureHandling: "none", zoomControl: false, keyboardShortcuts: false, defaultCenter: { lat: 31.5, lng: 74.3 }, defaultZoom: 14 });
    expect(h.props?.defaultBounds).toBeUndefined();
  });

  it("mirrors the camera onto data attributes, for debugging and browser tests", () => {
    render(<MapCanvas />);
    const onCameraChanged = h.props?.onCameraChanged as (e: unknown) => void;
    onCameraChanged({ detail: { zoom: 7.123, bounds: { south: 30, west: 72, north: 32, east: 75 } } });
    const el = screen.getByTestId("google-map");
    expect(el.dataset.mapZoom).toBe("7.12");
    expect(el.dataset.mapBounds).toBe("30.000,72.000,32.000,75.000");
  });

  it("renders its children inside the map", () => {
    render(<MapCanvas><span data-testid="child" /></MapCanvas>);
    expect(screen.getByTestId("map-recorder").querySelector("[data-testid=child]")).toBeTruthy();
  });
});
