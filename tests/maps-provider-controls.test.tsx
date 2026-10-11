// @vitest-environment jsdom
/**
 * GoogleMapsProvider (not configured / loaded / key rejected / script failed) and MapControls
 * (the view buttons fit the tenant's areas; there is no world view).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  config: { ok: true, apiKey: "test-key", mapId: "test-map-id" } as
    | { ok: true; apiKey: string; mapId: string }
    | { ok: false; reason: string; message: string },
  provider: null as null | Record<string, unknown>,
  map: null as null | { fitBounds: (...a: unknown[]) => void },
}));

vi.mock("@/lib/maps/config", () => ({
  get mapsConfig() { return h.config; },
  MAPS_REGION: "PK",
  MAPS_LANGUAGE: "en",
}));
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    h.provider = props;
    return <div data-testid="api-provider">{props.children}</div>;
  },
  useMap: () => h.map,
}));

import { GoogleMapsProvider, useMapId } from "../src/components/map/GoogleMapsProvider";
import { MapControls, StatusLegend } from "../src/components/map/MapControls";
import { MapConfigProvider } from "../src/components/map/MapConfigContext";
import { parseMapConfig } from "../src/lib/maps/regions";
import { STATUS_LABELS } from "../src/lib/maps/status";

beforeEach(() => {
  h.config = { ok: true, apiKey: "test-key", mapId: "test-map-id" };
  h.provider = null;
  h.map = null;
});
afterEach(cleanup);

function MapIdProbe() {
  return <span data-testid="map-id">{useMapId()}</span>;
}

describe("GoogleMapsProvider", () => {
  it("loads the Maps API for Pakistan with the configured key, and gives maps their Map ID", () => {
    render(<GoogleMapsProvider><MapIdProbe /></GoogleMapsProvider>);
    expect(h.provider).toMatchObject({ apiKey: "test-key", region: "PK", language: "en", version: "weekly" });
    expect(screen.getByTestId("map-id").textContent).toBe("test-map-id");
  });

  it("without a key, shows what to set instead of a broken map, and never loads the API", () => {
    h.config = { ok: false, reason: "missing_key", message: "The map is not configured: set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (see docs/MAP_STYLE.md)." };
    render(<GoogleMapsProvider><MapIdProbe /></GoogleMapsProvider>);
    expect(screen.getByText("The map is unavailable")).toBeTruthy();
    expect(screen.getByText(/NEXT_PUBLIC_GOOGLE_MAPS_API_KEY/)).toBeTruthy();
    expect(screen.queryByTestId("map-id")).toBeNull();
    expect(h.provider).toBeNull();
  });

  it("when Google rejects the key (gm_authFailure), keeps the map and says how to fix it", () => {
    render(<GoogleMapsProvider><MapIdProbe /></GoogleMapsProvider>);
    expect(screen.queryByTestId("maps-auth-failed")).toBeNull();
    act(() => { (window as unknown as { gm_authFailure: () => void }).gm_authFailure(); });
    expect(screen.getByTestId("maps-auth-failed").textContent).toContain("HTTP-referrer");
    expect(screen.getByTestId("map-id")).toBeTruthy(); // still mounted
  });

  it("a quiet provider (mini maps) does not show the notice", () => {
    render(<GoogleMapsProvider quiet><MapIdProbe /></GoogleMapsProvider>);
    act(() => { (window as unknown as { gm_authFailure: () => void }).gm_authFailure(); });
    expect(screen.queryByTestId("maps-auth-failed")).toBeNull();
  });

  it("chains a gm_authFailure handler that was already there, and restores it on unmount", () => {
    const previous = vi.fn();
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = previous;
    const view = render(<GoogleMapsProvider><MapIdProbe /></GoogleMapsProvider>);
    act(() => { (window as unknown as { gm_authFailure: () => void }).gm_authFailure(); });
    expect(previous).toHaveBeenCalledTimes(1);
    view.unmount();
    expect((window as unknown as { gm_authFailure?: () => void }).gm_authFailure).toBe(previous);
  });

  it("when the script cannot be loaded, replaces the map with a connection message", () => {
    render(<GoogleMapsProvider><MapIdProbe /></GoogleMapsProvider>);
    act(() => { (h.provider!.onError as () => void)(); });
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.queryByTestId("map-id")).toBeNull();
  });

  it("a map that throws while being set up is replaced by a notice; the rest of the page survives", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Exploding(): React.ReactNode {
      throw new TypeError("Cannot read properties of undefined (reading 'keys')");
    }
    render(
      <div>
        <span data-testid="kpi">12 animals</span>
        <GoogleMapsProvider><Exploding /></GoogleMapsProvider>
      </div>,
    );
    expect(screen.getByText("The map is unavailable")).toBeTruthy();
    expect(screen.getByText(/The rest of the page still works/)).toBeTruthy();
    expect(screen.getByTestId("kpi").textContent).toBe("12 animals");
    spy.mockRestore();
  });

  it("useMapId outside the provider throws (a map cannot exist without a Map ID)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<MapIdProbe />)).toThrow(/GoogleMapsProvider/);
    spy.mockRestore();
  });
});

describe("MapControls", () => {
  const fits: unknown[][] = [];
  const tenant = parseMapConfig({
    map: {
      service_area: { south: 24.8, west: 66.9, north: 25.1, east: 67.3, label: "Karachi" },
      country: { south: 23.6, west: 60.9, north: 37.1, east: 77.8, label: "Pakistan" },
    },
  });

  function mount(positions: Array<[number, number]>, config = tenant) {
    fits.length = 0;
    h.map = { fitBounds: (...a: unknown[]) => { fits.push(a); } };
    const onToggle = vi.fn();
    render(
      <MapConfigProvider config={config}>
        <MapControls satellite={false} onToggleSatellite={onToggle} positions={positions} />
      </MapConfigProvider>,
    );
    return onToggle;
  }

  it("labels the first button with the tenant's service area, not a hardcoded region", () => {
    mount([]);
    expect(screen.getByTestId("fit-service-area").textContent).toBe("Karachi");
    expect(screen.getByTestId("fit-country").textContent).toBe("Pakistan");
  });

  it("falls back to Punjab and Pakistan when the tenant sets nothing", () => {
    mount([], parseMapConfig(undefined));
    expect(screen.getByTestId("fit-service-area").textContent).toBe("Punjab");
    expect(screen.getByTestId("fit-country").textContent).toBe("Pakistan");
  });

  it("the area buttons fit exactly those bounds", () => {
    mount([]);
    fireEvent.click(screen.getByTestId("fit-service-area"));
    fireEvent.click(screen.getByTestId("fit-country"));
    expect(fits[0][0]).toEqual({ south: 24.8, west: 66.9, north: 25.1, east: 67.3 });
    expect(fits[1][0]).toEqual({ south: 23.6, west: 60.9, north: 37.1, east: 77.8 });
  });

  it("Fit to all animals fits a padded box around every animal, and is disabled with none", () => {
    mount([]);
    expect((screen.getByTestId("fit-all") as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    mount([[74.0, 31.0], [75.0, 32.0]]);
    fireEvent.click(screen.getByTestId("fit-all"));
    const box = fits[0][0] as { south: number; west: number; north: number; east: number };
    expect(box.south).toBeLessThan(31.0);
    expect(box.north).toBeGreaterThan(32.0);
    expect(box.west).toBeLessThan(74.0);
    expect(box.east).toBeGreaterThan(75.0);
  });

  it("has no world-view button", () => {
    mount([[74, 31]]);
    expect(screen.queryByText(/world/i)).toBeNull();
  });

  it("the satellite toggle reports its state and calls back", () => {
    const onToggle = mount([]);
    const button = screen.getByTestId("satellite-toggle");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does nothing, without error, before the map exists", () => {
    mount([[74, 31]]);
    h.map = null;
    expect(() => fireEvent.click(screen.getByTestId("fit-country"))).not.toThrow();
  });
});

describe("StatusLegend", () => {
  it("lists every status in words, not colour alone", () => {
    render(<StatusLegend />);
    const legend = screen.getByLabelText("Map legend");
    expect(Object.values(STATUS_LABELS)).toEqual(["Inside boundary", "Near boundary", "Breach", "Fast movement", "Offline"]);
    for (const word of Object.values(STATUS_LABELS)) expect(legend.textContent).toContain(word);
  });
});
