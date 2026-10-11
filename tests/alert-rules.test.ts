import { describe, it, expect } from "vitest";
import {
  haversineKm,
  computeSpeedKmh,
  evaluateAlerts,
  isBreachCondition,
  nextAnimalStatus,
  HARD_BREACH_METRES,
  SPEED_THRESHOLD_KMH,
  LOW_BATTERY_THRESHOLD,
  type SpatialContext,
  type AlertFixContext,
} from "../src/lib/alerts/alert-rules";

// ─── Helper builders ──────────────────────────────────────────────────────────
function spatial(overrides: Partial<SpatialContext> = {}): SpatialContext {
  return {
    insideFence: true,
    metresOutside: 0,
    metresToEdge: 9999,
    consecutiveOutsideCount: 0,
    warningBufferM: 500,
    ...overrides,
  };
}

function ctx(overrides: Partial<AlertFixContext> = {}): AlertFixContext {
  return {
    prevStatus: "inside",
    speedKmh: null,
    batteryPct: null,
    spatial: spatial(),
    animalLabel: "Bessie (Farmer A)",
    loanNumber: "LN-001",
    ...overrides,
  };
}

// ─── haversineKm ─────────────────────────────────────────────────────────────
describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(31.5, 74.3, 31.5, 74.3)).toBe(0);
  });

  it("is approximately 111 km per degree latitude", () => {
    const d = haversineKm(0, 0, 1, 0);
    expect(d).toBeCloseTo(111.19, 0);
  });

  it("Lahore to Faisalabad is roughly 120 km", () => {
    // Lahore: 31.5204° N, 74.3587° E
    // Faisalabad: 31.4180° N, 73.0790° E
    const d = haversineKm(31.5204, 74.3587, 31.418, 73.079);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(140);
  });
});

// ─── computeSpeedKmh ─────────────────────────────────────────────────────────
describe("computeSpeedKmh", () => {
  it("returns 0 when timestamps are equal", () => {
    const t = new Date("2024-01-01T00:00:00Z");
    expect(computeSpeedKmh(31.5, 74.3, t, 31.5, 74.3, t)).toBe(0);
  });

  it("computes 60 km/h for 60 km in 1 hour", () => {
    const t1 = new Date("2024-01-01T00:00:00Z");
    const t2 = new Date("2024-01-01T01:00:00Z");
    // Move ~1° lat ≈ 111 km — scale to 60 km
    const lat2 = 31.5 + 60 / 111;
    const speed = computeSpeedKmh(31.5, 74.3, t1, lat2, 74.3, t2);
    expect(speed).toBeCloseTo(60, 0);
  });
});

// ─── isBreachCondition ────────────────────────────────────────────────────────
describe("isBreachCondition", () => {
  it("returns false when inside fence", () => {
    expect(isBreachCondition(spatial({ insideFence: true }))).toBe(false);
  });

  it("returns false for single fix < 200 m outside (GPS drift case)", () => {
    // This is the critical GPS-drift test: a single fix 50 m outside should NOT breach
    expect(
      isBreachCondition(
        spatial({
          insideFence: false,
          metresOutside: 50,
          consecutiveOutsideCount: 1,
        }),
      ),
    ).toBe(false);
  });

  it("returns false for single fix exactly 199 m outside", () => {
    expect(
      isBreachCondition(
        spatial({
          insideFence: false,
          metresOutside: HARD_BREACH_METRES - 1,
          consecutiveOutsideCount: 1,
        }),
      ),
    ).toBe(false);
  });

  it("returns true for single fix exactly 200 m outside (hard threshold)", () => {
    expect(
      isBreachCondition(
        spatial({
          insideFence: false,
          metresOutside: HARD_BREACH_METRES,
          consecutiveOutsideCount: 1,
        }),
      ),
    ).toBe(true);
  });

  it("returns true for single fix > 200 m outside", () => {
    expect(
      isBreachCondition(
        spatial({
          insideFence: false,
          metresOutside: 500,
          consecutiveOutsideCount: 1,
        }),
      ),
    ).toBe(true);
  });

  it("returns true for 2 consecutive fixes outside (even if close)", () => {
    expect(
      isBreachCondition(
        spatial({
          insideFence: false,
          metresOutside: 10,
          consecutiveOutsideCount: 2,
        }),
      ),
    ).toBe(true);
  });
});

// ─── nextAnimalStatus ─────────────────────────────────────────────────────────
describe("nextAnimalStatus", () => {
  it("inside → inside when comfortably inside fence", () => {
    expect(nextAnimalStatus("inside", spatial(), false)).toBe("inside");
  });

  it("inside → near when close to boundary", () => {
    expect(
      nextAnimalStatus("inside", spatial({ metresToEdge: 100, warningBufferM: 500 }), false),
    ).toBe("near");
  });

  it("inside → breach on hard threshold", () => {
    const s = spatial({ insideFence: false, metresOutside: HARD_BREACH_METRES, consecutiveOutsideCount: 1 });
    expect(nextAnimalStatus("inside", s, false)).toBe("breach");
  });

  it("breach → inside when returned", () => {
    expect(nextAnimalStatus("breach", spatial({ insideFence: true }), false)).toBe("inside");
  });

  it("breach stays breach when still outside", () => {
    const s = spatial({ insideFence: false, metresOutside: 50, consecutiveOutsideCount: 1 });
    expect(nextAnimalStatus("breach", s, false)).toBe("breach");
  });

  it("inside → fast when fast movement", () => {
    expect(nextAnimalStatus("inside", spatial(), true)).toBe("fast");
  });

  it("breach overrides fast — stays breach when breached and fast", () => {
    const s = spatial({ insideFence: false, metresOutside: HARD_BREACH_METRES, consecutiveOutsideCount: 1 });
    expect(nextAnimalStatus("inside", s, true)).toBe("breach");
  });
});

// ─── evaluateAlerts ───────────────────────────────────────────────────────────
describe("evaluateAlerts", () => {
  it("returns no alerts when comfortably inside", () => {
    expect(evaluateAlerts(ctx())).toHaveLength(0);
  });

  it("does NOT fire breach for single GPS-drift fix < 200 m outside", () => {
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "inside",
        spatial: spatial({ insideFence: false, metresOutside: 150, consecutiveOutsideCount: 1 }),
      }),
    );
    expect(alerts.find(a => a.type === "breach")).toBeUndefined();
  });

  it("fires breach for single fix ≥ 200 m outside", () => {
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "inside",
        spatial: spatial({ insideFence: false, metresOutside: 200, consecutiveOutsideCount: 1 }),
      }),
    );
    expect(alerts.find(a => a.type === "breach")).toBeDefined();
  });

  it("fires breach for 2 consecutive fixes outside < 200 m", () => {
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "inside",
        spatial: spatial({ insideFence: false, metresOutside: 50, consecutiveOutsideCount: 2 }),
      }),
    );
    expect(alerts.find(a => a.type === "breach")).toBeDefined();
  });

  it("stores distanceKm on breach alert", () => {
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "inside",
        spatial: spatial({ insideFence: false, metresOutside: 400, consecutiveOutsideCount: 1 }),
      }),
    );
    const breach = alerts.find(a => a.type === "breach");
    expect(breach?.distanceKm).toBeCloseTo(0.4, 3);
  });

  it("does NOT re-raise breach when prevStatus is already breach", () => {
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "breach",
        spatial: spatial({ insideFence: false, metresOutside: 500, consecutiveOutsideCount: 2 }),
      }),
    );
    expect(alerts.find(a => a.type === "breach")).toBeUndefined();
  });

  it("fires near_boundary for single fix < 200 m outside (from inside)", () => {
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "inside",
        spatial: spatial({ insideFence: false, metresOutside: 150, consecutiveOutsideCount: 1 }),
      }),
    );
    expect(alerts.find(a => a.type === "near_boundary")).toBeDefined();
  });

  it("fires near_boundary when inside but close to edge", () => {
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "inside",
        spatial: spatial({ insideFence: true, metresToEdge: 100, warningBufferM: 500 }),
      }),
    );
    expect(alerts.find(a => a.type === "near_boundary")).toBeDefined();
  });

  it("fires returned when breach → inside", () => {
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "breach",
        spatial: spatial({ insideFence: true }),
      }),
    );
    expect(alerts.find(a => a.type === "returned")).toBeDefined();
  });

  it("returned does NOT also fire breach", () => {
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "breach",
        spatial: spatial({ insideFence: true }),
      }),
    );
    expect(alerts.find(a => a.type === "breach")).toBeUndefined();
  });

  it("fires fast_movement above threshold", () => {
    const alerts = evaluateAlerts(ctx({ speedKmh: SPEED_THRESHOLD_KMH + 1 }));
    expect(alerts.find(a => a.type === "fast_movement")).toBeDefined();
  });

  it("does NOT fire fast_movement at or below threshold", () => {
    const alerts = evaluateAlerts(ctx({ speedKmh: SPEED_THRESHOLD_KMH }));
    expect(alerts.find(a => a.type === "fast_movement")).toBeUndefined();
  });

  it("fires low_battery below threshold", () => {
    const alerts = evaluateAlerts(ctx({ batteryPct: LOW_BATTERY_THRESHOLD - 1 }));
    expect(alerts.find(a => a.type === "low_battery")).toBeDefined();
  });

  it("does NOT fire low_battery at threshold", () => {
    const alerts = evaluateAlerts(ctx({ batteryPct: LOW_BATTERY_THRESHOLD }));
    expect(alerts.find(a => a.type === "low_battery")).toBeUndefined();
  });

  it("near_boundary not fired when prevStatus is near (no spam)", () => {
    // Already near — no new near_boundary alert should be raised
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "near",
        spatial: spatial({ insideFence: false, metresOutside: 150, consecutiveOutsideCount: 1 }),
      }),
    );
    expect(alerts.find(a => a.type === "near_boundary")).toBeUndefined();
  });

  it("breach and fast can fire together", () => {
    const alerts = evaluateAlerts(
      ctx({
        prevStatus: "inside",
        speedKmh: 40,
        spatial: spatial({ insideFence: false, metresOutside: 300, consecutiveOutsideCount: 1 }),
      }),
    );
    expect(alerts.find(a => a.type === "breach")).toBeDefined();
    expect(alerts.find(a => a.type === "fast_movement")).toBeDefined();
  });
});
