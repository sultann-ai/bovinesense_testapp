/**
 * Everything the shell derives from a tenant's row: branding, timezone and clock format, demo banner,
 * offline threshold, and the region/branch scope logic. Pure functions.
 */
import { describe, expect, it } from "vitest";
import { brandStyle, contrastOnWhite, initialsOfName, parseBrand, safeLogoUrl } from "../src/lib/branding";
import { DEFAULT_TIMEZONE, formatAbsoluteTime, formatRelativeTime, hoursSince, resolveTimezone } from "../src/lib/format";
import { DEFAULT_OFFLINE_THRESHOLD_HOURS, demoBannerMessage, parseTenantSettings } from "../src/lib/tenant-settings";
import {
  NO_SCOPE, branchesFor, describeScope, parseStoredScope, reconcileScope, scopeKey, scopeParams, withScope,
  type ScopeLists,
} from "../src/lib/scope";

describe("tenant accent colour", () => {
  it("is the BovineSense default when the tenant sets nothing", () => {
    expect(parseBrand({})).toEqual({ accent: null });
    expect(parseBrand(null)).toEqual({ accent: null });
    expect(parseBrand("#123456")).toEqual({ accent: null });
    expect(brandStyle(parseBrand(undefined))).toEqual({});
  });

  it("accepts a readable #RRGGBB accent, normalised to upper case", () => {
    expect(parseBrand({ accent: "#1f4e79" })).toEqual({ accent: "#1F4E79" });
  });

  it.each(["1f4e79", "#1f4e7", "#1f4e79ff", "blue", "rgb(1,2,3)", 5, null])("ignores a malformed accent (%s)", (accent) => {
    expect(parseBrand({ accent })).toEqual({ accent: null });
  });

  it("ignores an accent that white button labels could not be read on", () => {
    expect(contrastOnWhite("#FFEB3B")).toBeLessThan(4.5);
    expect(parseBrand({ accent: "#FFEB3B" })).toEqual({ accent: null });
    expect(contrastOnWhite("#1F4E79")).toBeGreaterThan(4.5);
  });

  it("overrides ONLY the brand tokens, never a status token", () => {
    const style = brandStyle({ accent: "#1F4E79" });
    expect(Object.keys(style).sort()).toEqual(["--brand", "--brand-hover", "--brand-tint"]);
    expect(style["--brand"]).toBe("#1F4E79");
    expect(Object.keys(style).some((k) => k.startsWith("--status"))).toBe(false);
  });
});

describe("tenant logo", () => {
  it("accepts https, http and site paths", () => {
    expect(safeLogoUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    expect(safeLogoUrl("http://localhost:54321/storage/logo.png")).toContain("localhost");
    expect(safeLogoUrl("/logos/acme.svg")).toBe("/logos/acme.svg");
  });

  it.each(["javascript:alert(1)", "data:image/svg+xml;base64,AAAA", "//evil.example.com/x.png", "", "   ", null, 7, "not a url"])(
    "refuses %s",
    (v) => expect(safeLogoUrl(v)).toBeNull(),
  );

  it("falls back to initials from the tenant's own name", () => {
    expect(initialsOfName("Acme Lending Co")).toBe("AL");
    expect(initialsOfName("Bank of Somewhere")).toBe("BS");
    expect(initialsOfName("Solo")).toBe("SO");
    expect(initialsOfName("   ")).toBe("?");
  });
});

describe("timezone and clock format (DESIGN.md §4)", () => {
  const t = new Date("2026-10-08T09:32:00Z");

  it('prints "08 Oct 2026, 14:32 PKT" for the default timezone', () => {
    expect(formatAbsoluteTime(t)).toBe("08 Oct 2026, 14:32 PKT");
    expect(DEFAULT_TIMEZONE).toBe("Asia/Karachi");
  });

  it("uses the tenant's timezone, not Karachi's", () => {
    expect(formatAbsoluteTime(t, "UTC")).toBe("08 Oct 2026, 09:32 UTC");
    expect(formatAbsoluteTime(t, "Asia/Dubai")).toBe("08 Oct 2026, 13:32 GST");
    expect(formatAbsoluteTime(t, "America/New_York")).toMatch(/^08 Oct 2026, 05:32 /);
  });

  it("shows midnight as 00:00, not 24:00", () => {
    expect(formatAbsoluteTime(new Date("2026-10-08T19:05:00Z"), "Asia/Karachi")).toBe("09 Oct 2026, 00:05 PKT");
  });

  it("falls back to the default for an invalid timezone, and prints nothing for an invalid date", () => {
    expect(resolveTimezone("Mars/Olympus")).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(formatAbsoluteTime(t, "Mars/Olympus")).toBe("08 Oct 2026, 14:32 PKT");
    expect(formatAbsoluteTime("garbage")).toBe("");
  });

  it("relative time", () => {
    const now = Date.parse("2026-10-08T12:00:00Z");
    expect(formatRelativeTime("2026-10-08T11:59:30Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-10-08T11:37:00Z", now)).toBe("23 min ago");
    expect(formatRelativeTime("2026-10-08T09:00:00Z", now)).toBe("3 h ago");
    expect(formatRelativeTime("2026-10-07T12:00:00Z", now)).toBe("1 day ago");
    expect(formatRelativeTime("2026-10-05T12:00:00Z", now)).toBe("3 days ago");
  });

  it("hoursSince", () => {
    const now = Date.parse("2026-10-08T12:00:00Z");
    expect(hoursSince("2026-10-08T06:00:00Z", now)).toBe(6);
    expect(hoursSince(null, now)).toBeNull();
    expect(hoursSince("garbage", now)).toBeNull();
  });
});

describe("what a tenant row sets", () => {
  it("reads timezone, demo mode, offline threshold, accent and logo", () => {
    const t = parseTenantSettings({
      settings: { timezone: "Asia/Dubai", demo_mode: true, alert_rules: { offline_threshold_hours: 12 } },
      brandSettings: { accent: "#1f4e79" },
      logoUrl: "https://cdn.example.com/l.png",
    });
    expect(t).toMatchObject({ timezone: "Asia/Dubai", demoMode: true, offlineThresholdHours: 12, brand: { accent: "#1F4E79" }, logoUrl: "https://cdn.example.com/l.png" });
  });

  it("has safe defaults for an empty row", () => {
    const t = parseTenantSettings({ settings: {}, brandSettings: {}, logoUrl: null });
    expect(t).toEqual({
      timezone: DEFAULT_TIMEZONE, demoMode: false, demoBannerText: null,
      offlineThresholdHours: DEFAULT_OFFLINE_THRESHOLD_HOURS, brand: { accent: null }, logoUrl: null,
    });
    expect(parseTenantSettings({ settings: null, brandSettings: null, logoUrl: undefined }).demoMode).toBe(false);
  });

  it("demo mode needs an explicit true", () => {
    for (const v of ["true", 1, "yes", null]) {
      expect(parseTenantSettings({ settings: { demo_mode: v }, brandSettings: {}, logoUrl: null }).demoMode).toBe(false);
    }
  });

  it("ignores a nonsense offline threshold (below 1 h, not a number)", () => {
    for (const v of [0, -3, "6", NaN]) {
      expect(parseTenantSettings({ settings: { alert_rules: { offline_threshold_hours: v } }, brandSettings: {}, logoUrl: null }).offlineThresholdHours).toBe(6);
    }
  });

  it("builds the demo banner from the tenant's own counts, singular and plural", () => {
    expect(demoBannerMessage({ liveTags: 1, simulatedAnimals: 240 }, null)).toBe("Demo environment: 1 live tag, 240 simulated animals.");
    expect(demoBannerMessage({ liveTags: 3, simulatedAnimals: 1 }, null)).toBe("Demo environment: 3 live tags, 1 simulated animal.");
    expect(demoBannerMessage({ liveTags: 0, simulatedAnimals: 1200 }, null)).toBe("Demo environment: 0 live tags, 1,200 simulated animals.");
  });

  it("lets the tenant replace the banner text", () => {
    const t = parseTenantSettings({ settings: { demo_mode: true, demo_banner: "  Sandbox for Acme  " }, brandSettings: {}, logoUrl: null });
    expect(demoBannerMessage({ liveTags: 1, simulatedAnimals: 2 }, t.demoBannerText)).toBe("Sandbox for Acme");
  });
});

describe("scope selection", () => {
  const lists: ScopeLists = {
    regions: [{ id: 1, name: "North" }, { id: 2, name: "South" }],
    branches: [{ id: 10, name: "N-1", region_id: 1 }, { id: 11, name: "N-2", region_id: 1 }, { id: 20, name: "S-1", region_id: 2 }],
    locked: NO_SCOPE,
  };

  it("sends region_id / branch_id to the API only when chosen", () => {
    expect(scopeParams(NO_SCOPE)).toEqual({});
    expect(scopeParams({ regionId: 1, branchId: null })).toEqual({ region_id: "1" });
    expect(scopeParams({ regionId: 1, branchId: 11 })).toEqual({ region_id: "1", branch_id: "11" });
    expect(withScope("/api/kpi", { regionId: 2, branchId: null })).toBe("/api/kpi?region_id=2");
    expect(withScope("/api/alerts?type=breach", { regionId: 1, branchId: 10 })).toBe("/api/alerts?type=breach&region_id=1&branch_id=10");
    expect(withScope("/api/kpi", NO_SCOPE)).toBe("/api/kpi");
  });

  it("offers only the branches of the chosen region", () => {
    expect(branchesFor(1, lists.branches).map((b) => b.name)).toEqual(["N-1", "N-2"]);
    expect(branchesFor(null, lists.branches)).toHaveLength(3);
  });

  it("drops a selection that no longer exists or that does not fit together", () => {
    expect(reconcileScope({ regionId: 99, branchId: null }, lists)).toEqual(NO_SCOPE);
    expect(reconcileScope({ regionId: 1, branchId: 20 }, lists)).toEqual({ regionId: 1, branchId: null });
    expect(reconcileScope({ regionId: null, branchId: 99 }, lists)).toEqual(NO_SCOPE);
    expect(reconcileScope({ regionId: 2, branchId: 20 }, lists)).toEqual({ regionId: 2, branchId: 20 });
  });

  it("a membership's own region / branch cannot be widened", () => {
    expect(reconcileScope({ regionId: 2, branchId: null }, { ...lists, locked: { regionId: 1, branchId: null } })).toEqual({ regionId: 1, branchId: null });
    expect(reconcileScope(NO_SCOPE, { ...lists, locked: { regionId: 1, branchId: 11 } })).toEqual({ regionId: 1, branchId: 11 });
    expect(reconcileScope({ regionId: 2, branchId: 20 }, { ...lists, locked: { regionId: null, branchId: 10 } })).toEqual({ regionId: 1, branchId: 10 });
  });

  it("reads what was saved, and treats anything odd as everything", () => {
    expect(parseStoredScope(JSON.stringify({ regionId: 1, branchId: 10 }))).toEqual({ regionId: 1, branchId: 10 });
    for (const bad of [null, "", "{", "[]", JSON.stringify({ regionId: "1", branchId: -2 }), JSON.stringify({ regionId: 1.5 })]) {
      expect(parseStoredScope(bad)).toEqual(NO_SCOPE);
    }
  });

  it("names the scope and gives a stable key", () => {
    expect(describeScope({ regionId: 1, branchId: 11 }, lists)).toBe("N-2");
    expect(describeScope({ regionId: 2, branchId: null }, lists)).toBe("South");
    expect(describeScope(NO_SCOPE, lists)).toBe("All");
    expect(scopeKey({ regionId: 1, branchId: null })).toBe("1:all");
    expect(scopeKey(NO_SCOPE)).toBe("all:all");
  });
});
