import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_CONFIG, PAKISTAN_BOUNDS, PUNJAB_BOUNDS, expand, mapLimit, parseMapConfig, union,
} from "../src/lib/maps/regions";
import { ANIMAL_STATUSES, normalizeStatus, pinVisual } from "../src/lib/maps/status";
import { CLUSTER_MAX_ZOOM, clusterVisual, summarizeCluster } from "../src/lib/maps/cluster";
import { resolveMapsConfig } from "../src/lib/maps/config";

// ─── regions and tenant map settings ─────────────────────────────────────────────────────────────
describe("map configuration", () => {
  it("defaults to Punjab and Pakistan, never the world", () => {
    expect(DEFAULT_MAP_CONFIG.serviceArea).toEqual({ bounds: PUNJAB_BOUNDS, label: "Punjab" });
    expect(DEFAULT_MAP_CONFIG.country).toEqual({ bounds: PAKISTAN_BOUNDS, label: "Pakistan" });
    const w = DEFAULT_MAP_CONFIG.limit.east - DEFAULT_MAP_CONFIG.limit.west;
    const h = DEFAULT_MAP_CONFIG.limit.north - DEFAULT_MAP_CONFIG.limit.south;
    expect(w).toBeLessThan(40); // a region, nowhere near 360 degrees
    expect(h).toBeLessThan(40);
  });

  it("the camera limit contains both the country and the service area", () => {
    const { limit, country, serviceArea } = DEFAULT_MAP_CONFIG;
    for (const b of [country.bounds, serviceArea.bounds]) {
      expect(limit.south).toBeLessThanOrEqual(b.south);
      expect(limit.north).toBeGreaterThanOrEqual(b.north);
      expect(limit.west).toBeLessThanOrEqual(b.west);
      expect(limit.east).toBeGreaterThanOrEqual(b.east);
    }
  });

  it("a tenant can set its own service area and country (no Pakistan constants in the product)", () => {
    const c = parseMapConfig({
      map: {
        service_area: { south: -1.5, west: 36.6, north: -1.0, east: 37.1, label: "Nairobi" },
        country: { south: -4.7, west: 33.9, north: 5.0, east: 41.9, label: "Kenya" },
      },
    });
    expect(c.serviceArea.label).toBe("Nairobi");
    expect(c.country.label).toBe("Kenya");
    expect(c.limit.south).toBeLessThan(-4.7);
    expect(c.limit.west).toBeLessThan(33.9);
  });

  it("falls back, part by part, on anything missing or invalid", () => {
    expect(parseMapConfig(undefined)).toEqual(DEFAULT_MAP_CONFIG);
    expect(parseMapConfig(null)).toEqual(DEFAULT_MAP_CONFIG);
    expect(parseMapConfig("nope")).toEqual(DEFAULT_MAP_CONFIG);
    expect(parseMapConfig({ map: "x" })).toEqual(DEFAULT_MAP_CONFIG);
    expect(parseMapConfig({ map: [] })).toEqual(DEFAULT_MAP_CONFIG);

    const bad = [
      { south: 10, west: 70, north: 5, east: 75 },        // south above north
      { south: 10, west: 75, north: 20, east: 70 },       // west past east
      { south: "10", west: 70, north: 20, east: 75 },     // not numbers
      { south: 10, west: 70, north: 95, east: 75 },       // beyond the poles
      { south: 10, west: -200, north: 20, east: 75 },     // beyond the date line
      { south: Number.NaN, west: 70, north: 20, east: 75 },
    ];
    for (const b of bad) {
      expect(parseMapConfig({ map: { service_area: b } }).serviceArea, JSON.stringify(b)).toEqual(DEFAULT_MAP_CONFIG.serviceArea);
    }
    // a bad service area does not spoil a good country
    const mixed = parseMapConfig({ map: { service_area: bad[0], country: { south: 1, west: 2, north: 3, east: 4, label: "Z" } } });
    expect(mixed.country.label).toBe("Z");
    expect(mixed.serviceArea).toEqual(DEFAULT_MAP_CONFIG.serviceArea);
  });

  it("trims and bounds the label, and keeps the default label when blank", () => {
    const b = { south: 1, west: 2, north: 3, east: 4 };
    expect(parseMapConfig({ map: { service_area: { ...b, label: "  Sindh  " } } }).serviceArea.label).toBe("Sindh");
    expect(parseMapConfig({ map: { service_area: { ...b, label: "x".repeat(100) } } }).serviceArea.label).toHaveLength(30);
    expect(parseMapConfig({ map: { service_area: { ...b, label: "   " } } }).serviceArea.label).toBe("Punjab");
    expect(parseMapConfig({ map: { service_area: { ...b, label: 5 } } }).serviceArea.label).toBe("Punjab");
  });

  it("union and expand behave", () => {
    expect(union({ south: 0, west: 0, north: 1, east: 1 }, { south: -1, west: 0.5, north: 0.5, east: 2 })).toEqual({ south: -1, west: 0, north: 1, east: 2 });
    const e = expand({ south: 0, west: 0, north: 10, east: 20 }, 0.1);
    expect(e).toEqual({ south: -1, west: -2, north: 11, east: 22 });
    expect(expand({ south: -84, west: -179, north: 84, east: 179 }, 0.5)).toEqual({ south: -85, west: -180, north: 85, east: 180 });
    expect(mapLimit(PAKISTAN_BOUNDS, PUNJAB_BOUNDS)).toEqual(DEFAULT_MAP_CONFIG.limit);
  });
});

// ─── pins ────────────────────────────────────────────────────────────────────────────────────────
describe("pinVisual", () => {
  const pin = (over: Partial<Parameters<typeof pinVisual>[0]> = {}) =>
    pinVisual({ status: "inside", hasUnackBreach: false, selected: false, ...over });

  it("knows the five statuses and treats anything else as stale", () => {
    for (const s of ANIMAL_STATUSES) expect(normalizeStatus(s)).toBe(s);
    for (const bad of ["", "INSIDE", "lost", null, undefined, 3]) expect(normalizeStatus(bad)).toBe("stale");
  });

  it("pulses only for an unacknowledged breach", () => {
    expect(pin({ status: "breach", hasUnackBreach: true }).pulse).toBe(true);
    expect(pin({ status: "breach", hasUnackBreach: false }).pulse).toBe(false);
    for (const s of ["inside", "near", "fast", "stale"]) expect(pin({ status: s, hasUnackBreach: true }).pulse, s).toBe(false);
  });

  it("only stale is grey with the clock badge", () => {
    expect(pin({ status: "stale" }).stale).toBe(true);
    for (const s of ["inside", "near", "breach", "fast"]) expect(pin({ status: s }).stale, s).toBe(false);
    expect(pin({ status: "garbage" }).stale).toBe(true);
  });

  it("carries the selection through", () => {
    expect(pin({ selected: true }).selected).toBe(true);
    expect(pin().selected).toBe(false);
  });

  it("draws breaches above everything except the selected pin, and stale below everything", () => {
    const z = (s: string, selected = false) => pin({ status: s, selected }).zIndex;
    expect(z("breach")).toBeGreaterThan(z("fast"));
    expect(z("fast")).toBeGreaterThan(z("inside"));
    expect(z("inside")).toBeGreaterThan(z("stale"));
    expect(z("stale", true)).toBeGreaterThan(z("breach"));
  });

  it("says the status in words (never colour alone), with who it is", () => {
    expect(pin({ status: "breach", hasUnackBreach: true, tagSerial: "SIM-00007", animalName: "Bessie" }).label).toBe("SIM-00007 · Bessie: Breach (not acknowledged)");
    expect(pin({ status: "stale", tagSerial: "SIM-1" }).label).toBe("SIM-1: Offline");
    expect(pin({ status: "near" }).label).toBe("Near boundary");
    expect(pin({ status: "inside", tagSerial: null, animalName: "" }).label).toBe("Inside boundary");
  });
});

// ─── clusters ────────────────────────────────────────────────────────────────────────────────────
describe("clusters", () => {
  it("clusters only below zoom 10 (DESIGN.md)", () => {
    expect(CLUSTER_MAX_ZOOM).toBe(9);
  });

  it("counts animals and breaches, and reports the most urgent status", () => {
    expect(summarizeCluster(["inside", "inside"])).toEqual({ count: 2, breaches: 0, worst: "inside" });
    expect(summarizeCluster(["inside", "breach", "stale", "breach"])).toEqual({ count: 4, breaches: 2, worst: "breach" });
    expect(summarizeCluster(["inside", "near", "stale"]).worst).toBe("near");
    expect(summarizeCluster(["inside", "stale"]).worst).toBe("stale");
    expect(summarizeCluster(["fast", "near"]).worst).toBe("fast");
    expect(summarizeCluster([])).toEqual({ count: 0, breaches: 0, worst: "inside" });
  });

  it("counts unknown statuses as stale, never as breach", () => {
    expect(summarizeCluster(["???", null]).breaches).toBe(0);
  });

  it("a cluster with any breach gets the ring and the badge, with the breach count", () => {
    const v = clusterVisual(summarizeCluster(["inside", "breach", "breach", "inside", "inside"]));
    expect(v.hasBreach).toBe(true);
    expect(v.breachLabel).toBe("2");
    expect(v.ariaLabel).toBe("5 animals, 2 in breach");
  });

  it("a cluster without a breach has neither", () => {
    const v = clusterVisual(summarizeCluster(["inside", "near"]));
    expect(v).toMatchObject({ hasBreach: false, breachLabel: "", ariaLabel: "2 animals" });
  });

  it("caps the badge at 99+ and abbreviates big counts", () => {
    const many = Array.from({ length: 150 }, () => "breach");
    expect(clusterVisual(summarizeCluster(many)).breachLabel).toBe("99+");
    expect(clusterVisual({ count: 999, breaches: 0, worst: "inside" }).label).toBe("999");
    expect(clusterVisual({ count: 1000, breaches: 0, worst: "inside" }).label).toBe("1k");
    expect(clusterVisual({ count: 1500, breaches: 0, worst: "inside" }).label).toBe("1.5k");
    expect(clusterVisual({ count: 1, breaches: 0, worst: "inside" }).ariaLabel).toBe("1 animal");
  });

  it("bigger clusters are bigger bubbles", () => {
    const d = (n: number) => clusterVisual({ count: n, breaches: 0, worst: "inside" }).diameter;
    expect(d(5)).toBeLessThan(d(50));
    expect(d(50)).toBeLessThan(d(500));
  });
});

// ─── configuration from the environment ──────────────────────────────────────────────────────────
describe("resolveMapsConfig", () => {
  it("is ok with a key and a Map ID, trimmed", () => {
    expect(resolveMapsConfig("  key-123 ", " map-1 ")).toEqual({ ok: true, apiKey: "key-123", mapId: "map-1" });
  });

  it("explains what is missing instead of failing", () => {
    for (const k of [undefined, "", "   "]) {
      expect(resolveMapsConfig(k, "map")).toMatchObject({ ok: false, reason: "missing_key" });
    }
    for (const m of [undefined, "", "  "]) {
      expect(resolveMapsConfig("key", m)).toMatchObject({ ok: false, reason: "missing_map_id" });
    }
    const r = resolveMapsConfig(undefined, undefined);
    expect(r.ok === false && r.message).toContain("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
  });
});
