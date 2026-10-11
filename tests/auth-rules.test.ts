import { describe, it, expect } from "vitest";
import { isOrgOptionalPath, isOrgSelectionPath, isPublicPath, safeNextPath } from "../src/lib/auth/paths";

describe("isPublicPath", () => {
  it("allows exactly login, reset-password, the ingest endpoint and the health check", () => {
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/reset-password")).toBe(true);
    expect(isPublicPath("/api/ingest/fix")).toBe(true);
    expect(isPublicPath("/api/ingest")).toBe(true);
  });

  it("protects everything else, including look-alikes", () => {
    for (const p of [
      "/", "/alerts", "/animals", "/geofences", "/settings",
      "/api/kpi", "/api/device-keys", "/api/alerts/1/transition",
      "/api/ingestion", "/api/ingest-admin", "/login/evil", "/loginx",
      "/api/health/details", "/api/healthz", "/api/health/", "/health",
      "/reset-password/x", "/select-organization", "/org/continue",
    ]) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});

describe("isOrgSelectionPath", () => {
  it("covers the picker and the continue handler only", () => {
    expect(isOrgSelectionPath("/select-organization")).toBe(true);
    expect(isOrgSelectionPath("/org/continue")).toBe(true);
    expect(isOrgSelectionPath("/organization")).toBe(false);
    expect(isOrgSelectionPath("/alerts")).toBe(false);
  });
});

describe("isOrgOptionalPath", () => {
  it("adds sign-out to the picker routes, nothing else", () => {
    expect(isOrgOptionalPath("/select-organization")).toBe(true);
    expect(isOrgOptionalPath("/org/select")).toBe(true);
    expect(isOrgOptionalPath("/auth/signout")).toBe(true);
    expect(isOrgOptionalPath("/auth/signout/x")).toBe(false);
    expect(isOrgOptionalPath("/alerts")).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths with query and hash", () => {
    expect(safeNextPath("/alerts")).toBe("/alerts");
    expect(safeNextPath("/animals?status=breach#top")).toBe("/animals?status=breach#top");
  });

  it("falls back for anything that could leave the site", () => {
    for (const bad of [
      "https://evil.example", "//evil.example", "/\\evil.example", "evil.example",
      "javascript:alert(1)", "/%0d%0aSet-Cookie:x", "/a\r\nb", "",
    ]) {
      expect(safeNextPath(bad), bad).toBe("/");
    }
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined, "/alerts")).toBe("/alerts");
  });

  it("never redirects back into the auth pages or the API", () => {
    for (const p of ["/login", "/reset-password", "/select-organization", "/org/continue", "/auth/signout", "/api/kpi"]) {
      expect(safeNextPath(p), p).toBe("/");
    }
  });
});

describe("isSameOriginRequest", () => {
  const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

  it("accepts a POST from the same host and refuses another one", async () => {
    const { isSameOriginRequest } = await import("../src/lib/auth/origin");
    expect(isSameOriginRequest(headers({ host: "app.example.com", origin: "https://app.example.com" }))).toBe(true);
    expect(isSameOriginRequest(headers({ host: "app.example.com", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOriginRequest(headers({ host: "app.example.com", referer: "https://evil.example/x" }))).toBe(false);
    expect(isSameOriginRequest(headers({ host: "app.example.com", referer: "https://app.example.com/login" }))).toBe(true);
  });

  it("honours X-Forwarded-Host behind a proxy and rejects malformed Origin", async () => {
    const { isSameOriginRequest } = await import("../src/lib/auth/origin");
    expect(isSameOriginRequest(headers({ host: "internal:3000", "x-forwarded-host": "app.example.com", origin: "https://app.example.com" }))).toBe(true);
    expect(isSameOriginRequest(headers({ host: "app.example.com", origin: "not a url" }))).toBe(false);
  });

  it("lets header-less non-browser requests through (they carry no victim cookies)", async () => {
    const { isSameOriginRequest } = await import("../src/lib/auth/origin");
    expect(isSameOriginRequest(headers({ host: "app.example.com" }))).toBe(true);
  });
});
