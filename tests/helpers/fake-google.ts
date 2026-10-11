/**
 * A minimal stand-in for the parts of google.maps that the REAL @googlemaps/markerclusterer and our
 * map layers touch. Used because a real map needs a valid API key. It records what the code does
 * (fitBounds calls, marker positions, which markers are on the map) so tests can assert on it.
 * It is not a simulation of Google's rendering; clustering itself (supercluster) is the real library.
 */
type Listener = (...args: unknown[]) => void;

export class FakeLatLng {
  private readonly _lat: number;
  private readonly _lng: number;
  constructor(a: number | { lat: number; lng: number } | null, b?: number) {
    if (a !== null && typeof a === "object") { this._lat = a.lat; this._lng = a.lng; }
    else { this._lat = a as number; this._lng = b as number; }
  }
  lat() { return this._lat; }
  lng() { return this._lng; }
  toJSON() { return { lat: this._lat, lng: this._lng }; }
}

export class FakeLatLngBounds {
  constructor(public sw?: unknown, public ne?: unknown) {}
  extend() { return this; }
  toJSON() { return { north: 85, south: -85, east: 180, west: -180 }; }
}

/**
 * Google's OverlayView is an old-style constructor whose prototype methods are ENUMERABLE; the
 * clusterer copies them with for...in, which skips ES class methods. So this is built the same way.
 */
export interface FakeOverlayViewInstance {
  map: unknown;
  onAdd?(): void;
  onRemove?(): void;
  draw?(): void;
  setMap(map: unknown): void;
  getMap(): unknown;
  getProjection(): unknown;
}
export const FakeOverlayView = function (this: FakeOverlayViewInstance) {
  this.map = null;
} as unknown as { new (): FakeOverlayViewInstance };
Object.assign(FakeOverlayView.prototype, {
  setMap(this: FakeOverlayViewInstance, map: unknown) {
    if (map) { this.map = map; this.onAdd?.(); this.draw?.(); }
    else { this.onRemove?.(); this.map = null; }
  },
  getMap(this: FakeOverlayViewInstance) { return this.map; },
  getProjection() { return {}; },
});

export class FakeMap {
  zoom = 6;
  listeners = new Map<string, Set<Listener>>();
  calls = { fitBounds: [] as Array<{ bounds: unknown; padding: unknown }>, panTo: [] as unknown[], setZoom: [] as number[] };
  getZoom() { return this.zoom; }
  setZoom(z: number) { this.zoom = z; this.calls.setZoom.push(z); this.emit("zoom_changed"); }
  getBounds() { return new FakeLatLngBounds(); }
  getProjection() { return {}; }
  getMapCapabilities() { return { isAdvancedMarkersAvailable: true }; }
  fitBounds(bounds: unknown, padding: unknown) { this.calls.fitBounds.push({ bounds, padding }); }
  panTo(p: unknown) { this.calls.panTo.push(p); }
  addListener(event: string, cb: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return { remove: () => this.listeners.get(event)?.delete(cb) };
  }
  emit(event: string) { this.listeners.get(event)?.forEach((cb) => cb()); }
}

export class FakeAdvancedMarker {
  map: unknown = null;
  position: unknown;
  content: HTMLElement | undefined;
  zIndex: number | undefined;
  title: string | undefined;
  gmpClickable: boolean | undefined;
  handlers = new Map<string, Listener[]>();
  constructor(options: Record<string, unknown> = {}) { Object.assign(this, options); }
  addListener(event: string, cb: Listener) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
    return { remove() {} };
  }
  addEventListener(event: string, cb: Listener) { this.addListener(event, cb); }
  fire(event: string) { this.handlers.get(event)?.forEach((cb) => cb({})); }
}

export interface FakeGoogle {
  Map: typeof FakeMap;
  AdvancedMarkerElement: typeof FakeAdvancedMarker;
  /** Every marker constructed since the last install, in creation order. */
  markers: FakeAdvancedMarker[];
}

// The classes are defined ONCE: the clusterer defers some work with requestAnimationFrame, and a
// callback that fires after the next test has installed fresh classes would fail its instanceof checks.
const markers: FakeAdvancedMarker[] = [];
class RecordedMarker extends FakeAdvancedMarker {
  constructor(options: Record<string, unknown> = {}) { super(options); markers.push(this); }
}
const event = { trigger() {}, removeListener(l: { remove?: () => void } | undefined) { l?.remove?.(); }, addListener() { return { remove() {} }; } };
const maps = {
  LatLng: FakeLatLng,
  LatLngBounds: FakeLatLngBounds,
  OverlayView: FakeOverlayView,
  Map: FakeMap,
  marker: { AdvancedMarkerElement: RecordedMarker },
  event,
  Marker: class {},
  Point: class {},
  Size: class {},
};

/** Installs `globalThis.google` and returns handles for the tests (the recording starts empty). */
export function installFakeGoogle(): FakeGoogle {
  markers.length = 0;
  (globalThis as unknown as { google: unknown }).google = { maps };
  return { Map: FakeMap, AdvancedMarkerElement: RecordedMarker, markers };
}
