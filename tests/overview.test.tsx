// @vitest-environment jsdom
/**
 * The Overview: KPI cards, filter chips that really filter, the alert feed, the pin popup that leads to
 * the details drawer, the scope, and its error / empty states. The map and the drawer's data are
 * replaced by stubs (a real map needs a Google key); what is under test is the screen around them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  param: null as string | null,
  replace: vi.fn(),
  scopeKey: "all:all",
  scoped: (p: string) => p,
  kpi: { total: 3, inside_count: 2, inside_pct: 67, breach_count: 1, stale_count: 0, new_alerts: 1 } as unknown,
  kpiLoading: false,
  refreshKpi: vi.fn(),
  mapProps: null as null | Record<string, (...a: never[]) => void> & { markers: Array<{ properties: { id: number } }>; popupAnimalId: number | null; selectedAnimalId: number | null; flyToAnimalId: number | null },
  drawerProps: null as null | { animalId: number | null },
  denied: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "animal" ? h.param : null) }),
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
}));
vi.mock("../src/components/shell/ScopeProvider", () => ({
  useScope: () => ({ key: h.scopeKey, scoped: (p: string) => h.scoped(p), selection: { regionId: null, branchId: null } }),
}));
vi.mock("../src/components/shell/PermissionsProvider", () => ({
  usePermissions: () => ({ role: "org_admin", can: (p: string) => !h.denied.includes(p), readOnly: false }),
}));
vi.mock("../src/components/realtime/RealtimeProvider", () => ({
  useLive: () => ({ kpi: h.kpi, kpiLoading: h.kpiLoading, refreshKpi: h.refreshKpi, newAlertCount: 0, status: "live", resyncVersion: 0, subscribe: () => () => {} }),
  useLiveEvents: () => {},
  useResync: () => {},
}));
vi.mock("../src/components/overview/OverviewMap", () => ({
  OverviewMap: (props: NonNullable<typeof h.mapProps>) => {
    h.mapProps = props;
    return (
      <div data-testid="map-stub">
        {props.markers.map((m) => <button key={m.properties.id} data-testid={`pin-${m.properties.id}`} onClick={() => props.onMarkerClick(m.properties.id as never)}>pin</button>)}
        {props.popupAnimalId !== null && (
          <div data-testid="popup-stub">
            <button onClick={() => props.onOpenDetails(props.popupAnimalId as never)}>Open details</button>
            <button onClick={() => props.onClosePopup()}>Close popup</button>
          </div>
        )}
      </div>
    );
  },
}));
vi.mock("../src/components/overview/AnimalDrawer", () => ({
  AnimalDrawer: (props: { animalId: number | null }) => {
    h.drawerProps = props;
    return <div data-testid="drawer-stub" data-animal={props.animalId ?? ""} />;
  },
}));

import OverviewClient, { filterMarkers } from "../src/components/overview/OverviewClient";
import { TenantProvider } from "../src/components/shell/TenantProvider";

const TENANT = { name: "Meridian Credit", logoUrl: null, timezone: "UTC", offlineThresholdHours: 12 };
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
const marker = (id: number, status: string, fixedAt: string) => ({
  type: "Feature", id, geometry: { type: "Point", coordinates: [74 + id * 0.01, 31] },
  properties: { id, animal_name: `Cow ${id}`, status, tag_serial: `TAG-${id}`, borrower_name: `B${id}`, loan_number: `LN-${id}`, fixed_at: fixedAt, battery_pct: 80, has_unack_breach: false },
});
const MARKERS = [marker(1, "inside", hoursAgo(0.2)), marker(2, "breach", hoursAgo(3)), marker(3, "stale", hoursAgo(10))];
const feedAlert = (id: number) => ({
  id, type: "breach", severity: "critical", status: "new", title: `Left district ${id}`, detail: null, distance_km: 1, created_at: hoursAgo(0.1),
  animal_id: id, animal_name: "Cow", tag_serial: `TAG-${id}`, borrower_name: `B${id}`, loan_number: `LN-${id}`, branch_name: "Ridge",
});

let requests: string[];
let feedBody: () => { ok: boolean; body: unknown };
let markersBody: () => { ok: boolean; body: unknown };

beforeEach(() => {
  requests = [];
  h.param = null;
  h.denied = [];
  h.scopeKey = "all:all";
  h.scoped = (p) => p;
  h.kpi = { total: 3, inside_count: 2, inside_pct: 67, breach_count: 1, stale_count: 0, new_alerts: 1 };
  h.kpiLoading = false;
  h.refreshKpi.mockReset();
  h.replace.mockReset();
  feedBody = () => ({ ok: true, body: [feedAlert(2)] });
  markersBody = () => ({ ok: true, body: { type: "FeatureCollection", features: MARKERS } });
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    const r = url.startsWith("/api/alerts/feed") ? feedBody() : url.startsWith("/api/animals/markers") ? markersBody() : { ok: false, body: {} };
    return { ok: r.ok, status: r.ok ? 200 : 503, json: async () => r.body };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = () => render(<TenantProvider value={TENANT}><OverviewClient /></TenantProvider>);

describe("filterMarkers", () => {
  const now = Date.now();
  it("filters by animal status", () => {
    expect(filterMarkers(MARKERS as never, { status: "breach", lastFix: null, type: null }, now).map((m) => m.properties.id)).toEqual([2]);
  });
  it("filters by how old the last fix is", () => {
    const ids = (w: string) => filterMarkers(MARKERS as never, { status: null, lastFix: w, type: null }, now).map((m) => m.properties.id);
    expect(ids("1h")).toEqual([1]);
    expect(ids("6h")).toEqual([2]);
    expect(ids("24h")).toEqual([3]);
  });
  it("combines filters, and an alert-type filter does not hide animals", () => {
    expect(filterMarkers(MARKERS as never, { status: "stale", lastFix: "1h", type: null }, now)).toEqual([]);
    expect(filterMarkers(MARKERS as never, { status: null, lastFix: null, type: "breach" }, now)).toHaveLength(3);
  });
});

describe("Overview", () => {
  it("shows the KPI cards, with the breach card marked, and the tenant's offline threshold", async () => {
    mount();
    const cards = screen.getAllByTestId("kpi-card");
    expect(cards).toHaveLength(4);
    expect(within(cards[0]).getByText("3")).toBeTruthy();
    expect(within(cards[1]).getByText("67%")).toBeTruthy();
    expect(cards[2].dataset.alert).toBe("true");
    expect(within(cards[3]).getByText("no fix > 12 h")).toBeTruthy();
    await screen.findByText("Left district 2");
  });

  it("no breaches: the breach card is not marked", () => {
    h.kpi = { total: 3, inside_count: 3, inside_pct: 100, breach_count: 0, stale_count: 0, new_alerts: 0 };
    mount();
    expect(screen.getAllByTestId("kpi-card")[2].dataset.alert).toBe("false");
  });

  it("loading KPIs show skeletons, not zeros; a failed KPI load says so and retries", () => {
    h.kpi = null;
    h.kpiLoading = true;
    const view = mount();
    expect(within(screen.getByLabelText("Summary")).queryByText("0")).toBeNull();
    view.unmount();

    h.kpiLoading = false;
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    expect(screen.getByText("The summary numbers could not be loaded.")).toBeTruthy();
    expect(h.refreshKpi).toHaveBeenCalled();
  });

  it("the status chips really filter the pins on the map", async () => {
    mount();
    await waitFor(() => expect(h.mapProps?.markers).toHaveLength(3));
    fireEvent.click(within(screen.getByRole("group", { name: "Animal status" })).getByRole("button", { name: "Breach" }));
    expect(h.mapProps?.markers.map((m) => m.properties.id)).toEqual([2]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(h.mapProps?.markers).toHaveLength(3);
  });

  it("Clear all resets the status and the last-fix filters", async () => {
    mount();
    await waitFor(() => expect(h.mapProps?.markers).toHaveLength(3));
    fireEvent.click(within(screen.getByRole("group", { name: "Animal status" })).getByRole("button", { name: "Breach" }));
    fireEvent.change(screen.getByLabelText("Last fix"), { target: { value: "6h" } });
    expect(h.mapProps?.markers.map((m) => m.properties.id)).toEqual([2]); // breach, last fix 3 h ago: inside "1 to 6 hours"
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect((screen.getByLabelText("Last fix") as HTMLSelectElement).value).toBe("");
    expect(within(screen.getByRole("group", { name: "Animal status" })).getAllByRole("button").every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(h.mapProps?.markers).toHaveLength(3);
  });

  it("has one filter row: the five statuses and Last fix, and no second set of alert-type chips", () => {
    mount();
    const labels = within(screen.getByRole("group", { name: "Animal status" })).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["Inside", "Near boundary", "Breach", "Fast movement", "Offline"]);
    expect(screen.queryByRole("group", { name: "Alert type" })).toBeNull();
    expect(screen.queryByText("Breach alert")).toBeNull();
  });

  it("a KPI card filters the map, and the feed follows; clicking it again clears the filter", async () => {
    feedBody = () => ({ ok: true, body: [feedAlert(2), { ...feedAlert(3), type: "tag_offline", title: "Tag offline" }] });
    mount();
    await screen.findByText("Left district 2");
    fireEvent.click(screen.getByRole("button", { name: /^Active breaches/ }));
    expect(h.mapProps?.markers.map((m) => m.properties.id)).toEqual([2]);
    expect(screen.queryByText("Tag offline")).toBeNull();
    expect(screen.getByText("Left district 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Active breaches/ }));
    expect(h.mapProps?.markers).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /^Offline tags/ }));
    expect(h.mapProps?.markers.map((m) => m.properties.id)).toEqual([3]);
  });

  it("the alert panel shows its count and an Unacknowledged only switch", async () => {
    feedBody = () => ({ ok: true, body: [feedAlert(2), { ...feedAlert(3), status: "acknowledged", title: "Already seen" }] });
    mount();
    await screen.findByText("Already seen");
    expect(screen.getByTestId("alert-count").textContent).toBe("2");
    fireEvent.click(screen.getByRole("switch", { name: "Unacknowledged only" }));
    expect(screen.queryByText("Already seen")).toBeNull();
    expect(screen.getByTestId("alert-count").textContent).toBe("1");
  });

  it("asks again, with the scope, when the scope changes", async () => {
    h.scoped = (p) => `${p}${p.includes("?") ? "&" : "?"}region_id=1`;
    h.scopeKey = "1:all";
    const view = mount();
    await screen.findByText("Left district 2");
    expect(requests.filter((u) => u.includes("region_id=1")).length).toBeGreaterThanOrEqual(2); // feed + markers

    h.scoped = (p) => `${p}${p.includes("?") ? "&" : "?"}region_id=2`;
    h.scopeKey = "2:all";
    view.rerender(<TenantProvider value={TENANT}><OverviewClient /></TenantProvider>);
    await waitFor(() => expect(requests.filter((u) => u.includes("region_id=2")).length).toBeGreaterThanOrEqual(2));
  });

  it("a clicked pin opens the drawer for that animal", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("pin-2"));
    expect(h.mapProps?.selectedAnimalId).toBe(2);
    expect(screen.getByTestId("drawer-stub").dataset.animal).toBe("2");
  });

  it("an alert card's View on map opens the drawer and flies to the animal", async () => {
    mount();
    fireEvent.click(await screen.findByText("View on map"));
    expect(screen.getByTestId("drawer-stub").dataset.animal).toBe("2");
    expect(h.mapProps?.flyToAnimalId).toBe(2);
  });

  it("opening an alert from the feed opens the drawer straight away", async () => {
    mount();
    fireEvent.click(await screen.findByText("Open"));
    expect(screen.getByTestId("drawer-stub").dataset.animal).toBe("2");
  });

  it("?animal= (from search, Locate, a toast) selects, opens the drawer and cleans the URL", async () => {
    h.param = "3";
    mount();
    await screen.findByText("Left district 2");
    expect(screen.getByTestId("drawer-stub").dataset.animal).toBe("3");
    expect(h.mapProps?.selectedAnimalId).toBe(3);
    expect(h.replace).toHaveBeenCalledWith("/", { scroll: false });
  });

  it("shows Assign and Resolve on an open alert, and hides them for roles without permission", async () => {
    mount();
    await screen.findByText("Left district 2");
    expect(screen.getByRole("button", { name: /Assign/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Resolve/ })).toBeTruthy();
    cleanup();

    h.denied = ["alerts:acknowledge", "alerts:assign", "alerts:resolve"];
    mount();
    await screen.findByText("Left district 2");
    expect(screen.queryByRole("button", { name: /Assign/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Resolve/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Acknowledge/ })).toBeNull();
  });

  it("shows an empty feed calmly, with a way on", async () => {
    feedBody = () => ({ ok: true, body: [] });
    mount();
    await screen.findByText("No open alerts in this view.");
    expect(screen.getByRole("link", { name: "See all alerts" }).getAttribute("href")).toBe("/alerts");
  });

  it("a failed feed says so and retries", async () => {
    let fail = true;
    feedBody = () => (fail ? { ok: false, body: {} } : { ok: true, body: [feedAlert(2)] });
    mount();
    await screen.findByText("The alerts could not be loaded.");
    fail = false;
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]); });
    await screen.findByText("Left district 2");
  });

  it("failed animals are announced above the map, with a retry", async () => {
    let fail = true;
    markersBody = () => (fail ? { ok: false, body: {} } : { ok: true, body: { type: "FeatureCollection", features: MARKERS } });
    mount();
    await screen.findByText(/The animals could not be loaded/);
    fail = false;
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]); });
    await waitFor(() => expect(screen.queryByText(/The animals could not be loaded/)).toBeNull());
  });
});
