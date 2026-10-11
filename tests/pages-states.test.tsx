// @vitest-environment jsdom
/**
 * The Animals and Alerts screens: skeleton while loading, rows when loaded, an empty state with one
 * action, an error state with a retry, filters, the scope, and role-dependent actions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  scopeKey: "all:all",
  scoped: (p: string) => p,
  can: (() => true) as (p: string) => boolean,
  push: vi.fn(),
  liveHandlers: [] as Array<(e: unknown) => void>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("../src/components/shell/ScopeProvider", () => ({
  useScope: () => ({ key: h.scopeKey, scoped: (p: string) => h.scoped(p), branches: [{ id: 1, name: "Lahore Main", region_id: 1 }] }),
}));
vi.mock("../src/components/shell/PermissionsProvider", () => ({
  usePermissions: () => ({ role: "org_admin", can: h.can, readOnly: false }),
}));
vi.mock("../src/components/realtime/RealtimeProvider", () => ({
  useLiveEvents: (fn: (e: unknown) => void) => { h.liveHandlers.push(fn); },
  useResync: () => {},
}));

import AnimalsPage from "../src/app/(app)/animals/page";
import AlertsPage from "../src/app/(app)/alerts/page";
import { TenantProvider } from "../src/components/shell/TenantProvider";

const TENANT = { name: "Meridian Credit", logoUrl: null, timezone: "UTC", offlineThresholdHours: 6 };
const wrap = (ui: React.ReactElement) => <TenantProvider value={TENANT}>{ui}</TenantProvider>;

const animal = (id: number, over: Record<string, unknown> = {}) => ({
  id, name: `Cow ${id}`, species: "cattle", status: "inside", tag_serial: `TAG-${id}`, borrower_name: `Borrower ${id}`,
  loan_number: `LN-${id}`, branch_name: "Ridge", district: "Highlands", last_fix_at: new Date(Date.now() - 20 * 60_000).toISOString(),
  battery_pct: 80, lat: 31, lon: 74, ...over,
});
const alert = (id: number, over: Record<string, unknown> = {}) => ({
  id, type: "breach", severity: "critical", status: "new", title: `Left district ${id}`, detail: null, distance_km: 1.2,
  created_at: new Date(Date.now() - 5 * 60_000).toISOString(), resolved_at: null, resolution_reason: null,
  animal_id: id * 10, animal_name: "Cow", tag_serial: `TAG-${id}`, borrower_name: `Borrower ${id}`, loan_number: `LN-${id}`, branch_id: 1, branch_name: "Ridge", ...over,
});

let requests: string[];
let responder: (url: string) => { ok: boolean; body: unknown } | Promise<{ ok: boolean; body: unknown }>;

beforeEach(() => {
  requests = [];
  h.scopeKey = "all:all";
  h.scoped = (p) => p;
  h.can = () => true;
  h.push.mockReset();
  h.liveHandlers = [];
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    const r = await responder(url);
    return { ok: r.ok, status: r.ok ? 200 : 503, json: async () => r.body };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Animals", () => {
  it("shows skeleton rows first, then the animals with status in words and a locate button", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    responder = async () => { await gate; return { ok: true, body: [animal(1), animal(2, { status: "breach" })] }; };
    render(wrap(<AnimalsPage />));
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    await act(async () => { release(); });
    await screen.findByText("TAG-1");
    expect(screen.queryAllByTestId("skeleton-row")).toHaveLength(0);
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Inside boundary")).toBeTruthy();
    expect(table.getByText("Breach")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Locate on map" })).toHaveLength(2);
  });

  it("Locate opens the Overview on that animal", async () => {
    responder = () => ({ ok: true, body: [animal(7)] });
    render(wrap(<AnimalsPage />));
    await screen.findByText("TAG-7");
    fireEvent.click(screen.getByRole("button", { name: "Locate on map" }));
    expect(h.push).toHaveBeenCalledWith("/?animal=7");
  });

  it("shows a stale last fix in grey with the clock, using the tenant's threshold", async () => {
    responder = () => ({ ok: true, body: [animal(1, { last_fix_at: new Date(Date.now() - 9 * 3_600_000).toISOString() }), animal(2, { last_fix_at: null })] });
    const { container } = render(wrap(<AnimalsPage />));
    await screen.findByText("TAG-1");
    expect(container.querySelector('time[data-stale="true"]')).toBeTruthy();
    expect(screen.getByText("No fix")).toBeTruthy();
  });

  it("an empty fleet gets one sentence and one action", async () => {
    responder = () => ({ ok: true, body: [] });
    render(wrap(<AnimalsPage />));
    await screen.findByText("No animals are tracked in this view yet.");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("filtering to nothing offers to clear the filters, and clearing brings the rows back", async () => {
    responder = (url) => ({ ok: true, body: url.includes("status=breach") ? [] : [animal(1)] });
    render(wrap(<AnimalsPage />));
    await screen.findByText("TAG-1");
    fireEvent.click(screen.getByRole("button", { name: "Breach" }));
    await screen.findByText("No animals match these filters.");
    expect(requests.some((u) => u.includes("status=breach"))).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await screen.findByText("TAG-1");
  });

  it("says what failed and retries", async () => {
    let fail = true;
    responder = () => (fail ? { ok: false, body: {} } : { ok: true, body: [animal(1)] });
    render(wrap(<AnimalsPage />));
    await screen.findByText("The animals could not be loaded.");
    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await screen.findByText("TAG-1");
    expect(screen.queryByText("The animals could not be loaded.")).toBeNull();
  });

  it("sends the scope with every request, and asks again when it changes", async () => {
    h.scopeKey = "1:all";
    h.scoped = (p) => `${p}${p.includes("?") ? "&" : "?"}region_id=1`;
    responder = () => ({ ok: true, body: [animal(1)] });
    const view = render(wrap(<AnimalsPage />));
    await screen.findByText("TAG-1");
    expect(requests[0]).toContain("region_id=1");

    h.scopeKey = "2:all";
    h.scoped = (p) => `${p}${p.includes("?") ? "&" : "?"}region_id=2`;
    view.rerender(wrap(<AnimalsPage />));
    await waitFor(() => expect(requests.some((u) => u.includes("region_id=2"))).toBe(true));
  });

  it("refreshes in place (no skeleton flash) when an animal's status changes live", async () => {
    responder = () => ({ ok: true, body: [animal(1)] });
    render(wrap(<AnimalsPage />));
    await screen.findByText("TAG-1");
    const before = requests.length;
    responder = () => ({ ok: true, body: [animal(1, { status: "breach" })] });
    await act(async () => { h.liveHandlers.forEach((fn) => fn({ kind: "animal", animal: { id: 1, status: "breach" } })); });
    await within(screen.getByRole("table")).findByText("Breach");
    expect(requests.length).toBe(before + 1);
    expect(screen.queryAllByTestId("skeleton-row")).toHaveLength(0);
  });
});

describe("Alerts", () => {
  it("lists alerts with their type and state as pills, and a locate button", async () => {
    responder = () => ({ ok: true, body: [alert(1), alert(2, { type: "fast_movement", status: "assigned", title: "Moving fast" })] });
    render(wrap(<AlertsPage />));
    await screen.findByText("Left district 1");
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Fast movement")).toBeTruthy();
    expect(table.getByText("Assigned")).toBeTruthy();
    expect(table.getByText("New")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Locate on map" })).toHaveLength(2);
    expect(screen.getByText("1 new")).toBeTruthy();
  });

  it("sends the chosen filters and scope to the API", async () => {
    h.scoped = (p) => `${p}${p.includes("?") ? "&" : "?"}branch_id=10`;
    responder = () => ({ ok: true, body: [alert(1)] });
    render(wrap(<AlertsPage />));
    await screen.findByText("Left district 1");
    fireEvent.click(screen.getByRole("button", { name: "Breach" }));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledged" }));
    await waitFor(() => expect(requests.some((u) => u.includes("type=breach") && u.includes("status=acknowledged") && u.includes("branch_id=10"))).toBe(true));
  });

  it("the date range and branch narrow the list and are carried into Export CSV", async () => {
    responder = () => ({ ok: true, body: [alert(1)] });
    render(wrap(<AlertsPage />));
    await screen.findByText("Left district 1");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-09" } });
    fireEvent.change(screen.getByLabelText("Branch"), { target: { value: "1" } });
    await waitFor(() => expect(requests.some((u) => u.startsWith("/api/alerts?") && u.includes("from_date=2026-10-01") && u.includes("to_date=2026-10-09") && u.includes("branch_id=1"))).toBe(true));
    const href = screen.getByRole("link", { name: /Export CSV/ }).getAttribute("href") ?? "";
    expect(href.startsWith("/api/alerts/export?")).toBe(true);
    expect(href).toContain("from_date=2026-10-01");
    expect(href).toContain("to_date=2026-10-09");
    expect(href).toContain("branch_id=1");
  });

  it("an empty list is calm: it says so and offers the Overview", async () => {
    responder = () => ({ ok: true, body: [] });
    render(wrap(<AlertsPage />));
    await screen.findByText(/No alerts in this view/);
    expect(screen.getByRole("link", { name: "Open Overview" }).getAttribute("href")).toBe("/");
  });

  it("says what failed and retries", async () => {
    let fail = true;
    responder = () => (fail ? { ok: false, body: {} } : { ok: true, body: [alert(1)] });
    render(wrap(<AlertsPage />));
    await screen.findByText("The alerts could not be loaded.");
    fail = false;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await screen.findByText("Left district 1");
  });

  it("offers bulk acknowledge only to someone who may acknowledge", async () => {
    responder = () => ({ ok: true, body: [alert(1), alert(2)] });
    h.can = () => false;
    const view = render(wrap(<AlertsPage />));
    await screen.findByText("Left district 1");
    expect(screen.queryByLabelText("Select all")).toBeNull();
    view.unmount();

    h.can = () => true;
    render(wrap(<AlertsPage />));
    await screen.findByText("Left district 1");
    fireEvent.click(screen.getByLabelText("Select all"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Acknowledge all" })).toBeTruthy();
  });

  it("bulk acknowledge reports the ones that failed instead of pretending they worked", async () => {
    responder = (url) => {
      if (url.includes("/transition")) return { ok: !url.includes("/2/"), body: {} };
      return { ok: true, body: [alert(1), alert(2)] };
    };
    const calls: string[] = [];
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") calls.push(url);
      return base(url);
    });
    render(wrap(<AlertsPage />));
    await screen.findByText("Left district 1");
    fireEvent.click(screen.getByLabelText("Select all"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Acknowledge all" })); });
    await screen.findByText(/1 of 2 alerts could not be acknowledged/);
    expect(calls).toHaveLength(2);
  });

  it("the resolve reasons use lender-neutral wording", async () => {
    responder = (url) => (url.startsWith("/api/alerts/1") ? { ok: true, body: { ...alert(1), audit: [] } } : { ok: true, body: [alert(1)] });
    render(wrap(<AlertsPage />));
    fireEvent.click(await screen.findByText("Left district 1"));
    fireEvent.click(await screen.findByRole("button", { name: "Resolve…" }));
    const select = await screen.findByLabelText(/Resolution reason/);
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toContain("Moved with consent");
    expect(options.join(" ")).not.toMatch(/bank/i);
  });
});
