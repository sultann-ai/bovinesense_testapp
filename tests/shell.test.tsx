// @vitest-environment jsdom
/**
 * The app shell: the top bar (tenant brand, search, scope selector, bell, user menu with role and
 * organization switcher), the demo banner, tenant logo and the scope provider. Everything tenant-specific
 * comes from props / the API, so these tests use a made-up tenant.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  live: { newAlertCount: 0, status: "live" as string },
  pathname: "/alerts",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => h.pathname,
  useRouter: () => ({ push: h.push, replace: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("../src/components/realtime/RealtimeProvider", () => ({
  useLive: () => h.live,
}));

import { TopBar } from "../src/components/shell/TopBar";
import { ScopeProvider, useScope } from "../src/components/shell/ScopeProvider";
import { ScopeSelector } from "../src/components/shell/ScopeSelector";
import { TenantProvider } from "../src/components/shell/TenantProvider";
import { TenantLogo } from "../src/components/shell/TenantLogo";
import { DemoModeBanner } from "../src/components/shell/DemoModeBanner";
import { GlobalSearch } from "../src/components/shell/GlobalSearch";
import { ComingSoon } from "../src/components/shell/ComingSoon";
import { AccessDenied } from "../src/components/shell/AccessDenied";

const ORG = "11111111-1111-4111-8111-111111111111";
const TENANT = { name: "Meridian Credit", logoUrl: null as string | null, timezone: "UTC", offlineThresholdHours: 6 };

const LISTS = {
  regions: [{ id: 1, name: "Highlands" }, { id: 2, name: "Coast" }],
  branches: [{ id: 10, name: "Ridge", region_id: 1 }, { id: 11, name: "Valley", region_id: 1 }, { id: 20, name: "Harbour", region_id: 2 }],
  locked: { regionId: null as number | null, branchId: null as number | null },
};

let lists = LISTS;
let fetchCalls: string[];

beforeAll(() => {
  // jsdom lacks what Radix Select / DropdownMenu use
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

beforeEach(() => {
  h.live = { newAlertCount: 0, status: "live" };
  h.pathname = "/alerts";
  h.push.mockReset();
  lists = LISTS;
  fetchCalls = [];
  window.localStorage.clear();
  vi.stubGlobal("fetch", async (url: string) => {
    fetchCalls.push(url);
    if (url.startsWith("/api/scope")) return { ok: true, status: 200, json: async () => lists };
    if (url.startsWith("/api/search")) return { ok: true, status: 200, json: async () => [] };
    return { ok: false, status: 404, json: async () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function shell(props: Partial<React.ComponentProps<typeof TopBar>> = {}, tenant = TENANT) {
  return render(
    <TenantProvider value={tenant}>
      <ScopeProvider organizationId={ORG}>
        <TopBar
          user={{ name: "Sana Malik", email: "sana@meridian.example" }}
          role="org_admin"
          activeOrganizationId={ORG}
          organizations={[{ id: ORG, name: "Meridian Credit" }]}
          {...props}
        />
      </ScopeProvider>
    </TenantProvider>,
  );
}

describe("top bar: the tenant's brand", () => {
  it("shows the tenant's name with Powered by BovineSense, taken from tenant data", () => {
    shell();
    expect(screen.getByTestId("tenant-name").textContent).toBe("Meridian Credit");
    expect(screen.getByTestId("tenant-brand").textContent).toContain("Powered by BovineSense");
  });

  it("a different tenant shows a different name (nothing is hardcoded)", () => {
    shell({}, { ...TENANT, name: "Northwind Finance" });
    expect(screen.getByTestId("tenant-name").textContent).toBe("Northwind Finance");
    expect(document.body.textContent).not.toMatch(/Meridian|Bank of Punjab/);
  });

  it("shows the tenant's logo when it has one, else its initials", () => {
    const { container, unmount } = shell({}, { ...TENANT, logoUrl: "https://cdn.example.com/meridian.png" });
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/meridian.png");
    expect(img.getAttribute("alt")).toBe("Meridian Credit logo");
    unmount();
    shell();
    expect(screen.getByTestId("tenant-logo-fallback").textContent).toBe("MC");
  });

  it("is 64 px tall", () => {
    const { container } = shell();
    expect(container.querySelector("header")?.className).toContain("h-16");
  });
});

describe("tenant logo", () => {
  it("falls back to initials when the image fails to load", () => {
    const { container } = render(<TenantLogo name="Meridian Credit" logoUrl="https://cdn.example.com/missing.png" />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByTestId("tenant-logo-fallback").textContent).toBe("MC");
  });
});

describe("top bar: alert bell", () => {
  it("shows the live count and says it in words", () => {
    h.live.newAlertCount = 7;
    shell();
    expect(screen.getByTestId("bell-badge").textContent).toBe("7");
    expect(screen.getByTestId("bell").getAttribute("aria-label")).toBe("7 open alerts");
    expect(screen.getByTestId("bell").getAttribute("href")).toBe("/alerts");
  });

  it("has no badge at zero, says 1 open alert in the singular, and caps at 99+", () => {
    shell();
    expect(screen.queryByTestId("bell-badge")).toBeNull();
    cleanup();
    h.live.newAlertCount = 1;
    shell();
    expect(screen.getByTestId("bell").getAttribute("aria-label")).toBe("1 open alert");
    cleanup();
    h.live.newAlertCount = 250;
    shell();
    expect(screen.getByTestId("bell-badge").textContent).toBe("99+");
  });
});

describe("top bar: user menu", () => {
  async function openMenu() {
    const trigger = screen.getByLabelText("Account menu");
    await act(async () => { fireEvent.keyDown(trigger, { key: "Enter" }); });
    return screen.findByTestId("account-summary");
  }

  it("shows the person, their role and the organization", async () => {
    shell();
    expect(screen.getByLabelText("Account menu").textContent).toContain("Admin");
    const summary = await openMenu();
    expect(summary.textContent).toContain("Sana Malik");
    expect(summary.textContent).toContain("sana@meridian.example");
    expect(summary.textContent).toContain("Organization admin · Meridian Credit");
  });

  it("offers no switcher when there is only one organization", async () => {
    shell();
    await openMenu();
    expect(screen.queryByText("Switch organization")).toBeNull();
  });

  it("lists the organizations to switch between, marks the current one, and posts the choice", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const { container } = shell({ organizations: [{ id: ORG, name: "Meridian Credit" }, { id: OTHER, name: "Northwind Finance" }] });
    const form = container.querySelector('form[action="/org/select"]') as HTMLFormElement;
    form.requestSubmit = vi.fn();
    await openMenu();
    expect(screen.getByText("Switch organization")).toBeTruthy();
    expect(within(screen.getByTestId(`switch-org-${ORG}`)).getByLabelText("Current organization")).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByTestId(`switch-org-${OTHER}`)); });
    expect((form.querySelector('input[name="organization_id"]') as HTMLInputElement).value).toBe(OTHER);
    expect((form.querySelector('input[name="next"]') as HTMLInputElement).value).toBe("/alerts");
    expect(form.requestSubmit).toHaveBeenCalledTimes(1);
  });

  it("choosing the current organization does nothing", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const { container } = shell({ organizations: [{ id: ORG, name: "Meridian Credit" }, { id: OTHER, name: "Northwind Finance" }] });
    const form = container.querySelector('form[action="/org/select"]') as HTMLFormElement;
    form.requestSubmit = vi.fn();
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByTestId(`switch-org-${ORG}`)); });
    expect(form.requestSubmit).not.toHaveBeenCalled();
  });

  it("signs out with a form POST", async () => {
    const { container } = shell();
    const form = container.querySelector('form[action="/auth/signout"]') as HTMLFormElement;
    form.requestSubmit = vi.fn();
    await openMenu();
    await act(async () => { fireEvent.click(screen.getByText("Sign out")); });
    expect(form.requestSubmit).toHaveBeenCalled();
  });
});

describe("scope provider and selector", () => {
  function Probe() {
    const s = useScope();
    return <output data-testid="probe">{s.key}|{s.scoped("/api/kpi")}|{s.status}</output>;
  }
  const mount = () =>
    render(<ScopeProvider organizationId={ORG}><Probe /><ScopeSelector /></ScopeProvider>);

  const choose = async (label: string, option: string) => {
    const trigger = screen.getByLabelText(label);
    await act(async () => { fireEvent.keyDown(trigger, { key: "Enter" }); });
    const item = await screen.findByRole("option", { name: option });
    await act(async () => { fireEvent.click(item); });
  };

  it("loads the tenant's regions and branches from the API", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("ready"));
    expect(fetchCalls).toContain("/api/scope");
    expect(screen.getByTestId("probe").textContent).toBe("all:all|/api/kpi|ready");
    expect(screen.getByLabelText("Region").textContent).toBe("All regions");
    expect(screen.getByLabelText("Branch").textContent).toBe("All branches");
  });

  it("choosing a region scopes the app, and offers only that region's branches", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("ready"));
    await choose("Region", "Highlands");
    expect(screen.getByTestId("probe").textContent).toBe("1:all|/api/kpi?region_id=1|ready");

    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Branch"), { key: "Enter" }); });
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["All branches", "Ridge", "Valley"]);
  });

  it("choosing a branch scopes to it; changing the region clears the branch", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("ready"));
    await choose("Region", "Highlands");
    await choose("Branch", "Valley");
    expect(screen.getByTestId("probe").textContent).toBe("1:11|/api/kpi?region_id=1&branch_id=11|ready");
    await choose("Region", "Coast");
    expect(screen.getByTestId("probe").textContent).toBe("2:all|/api/kpi?region_id=2|ready");
  });

  it("remembers the choice per organization", async () => {
    const first = mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("ready"));
    await choose("Region", "Coast");
    expect(JSON.parse(window.localStorage.getItem(`bs:scope:${ORG}`)!)).toEqual({ regionId: 2, branchId: null });
    first.unmount();

    mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("2:all"));

    // another organization starts from everything
    cleanup();
    render(<ScopeProvider organizationId="33333333-3333-4333-8333-333333333333"><Probe /></ScopeProvider>);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("ready"));
    expect(screen.getByTestId("probe").textContent).toContain("all:all");
  });

  it("drops a saved choice that no longer exists", async () => {
    window.localStorage.setItem(`bs:scope:${ORG}`, JSON.stringify({ regionId: 99, branchId: null }));
    mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("ready"));
    expect(screen.getByTestId("probe").textContent).toContain("all:all");
  });

  it("shows what the membership fixes, locked", async () => {
    lists = { ...LISTS, regions: [LISTS.regions[0]], branches: LISTS.branches.slice(0, 2), locked: { regionId: 1, branchId: null } };
    mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("ready"));
    expect(screen.getByTestId("probe").textContent).toContain("1:all");
    expect(screen.getByLabelText("Region").textContent).toBe("Highlands");
    expect((screen.getByLabelText("Region") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Branch") as HTMLButtonElement).disabled).toBe(false);
  });

  it("locks the branch too for a branch officer", async () => {
    lists = { ...LISTS, regions: [LISTS.regions[0]], branches: [LISTS.branches[0]], locked: { regionId: 1, branchId: 10 } };
    mount();
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("ready"));
    expect(screen.getByTestId("probe").textContent).toContain("1:10");
    expect((screen.getByLabelText("Branch") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says when it cannot load, with a retry that works", async () => {
    let fail = true;
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.startsWith("/api/scope")) return fail ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => LISTS };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    mount();
    await screen.findByText("Regions unavailable");
    fail = false;
    await act(async () => { fireEvent.click(screen.getByText("Retry")); });
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toContain("ready"));
    expect(screen.queryByText("Regions unavailable")).toBeNull();
  });
});

describe("demo-mode banner", () => {
  it("shows the message it is given (built from the tenant's own counts by the layout)", () => {
    render(<DemoModeBanner message="Demo environment: 2 live tags, 12 simulated animals." />);
    const note = screen.getByRole("note");
    expect(note.textContent).toBe("Demo environment: 2 live tags, 12 simulated animals.");
    expect(note.style.borderLeftColor).toBe("var(--highlight)");
  });
});

describe("global search", () => {
  it("does not search for fewer than two characters", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<GlobalSearch />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(fetchCalls.filter((u) => u.startsWith("/api/search"))).toEqual([]);
    vi.useRealTimers();
  });

  it("finds by tag, loan or borrower, shows status in words, and opens the animal on the overview", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", async (url: string) => {
      fetchCalls.push(url);
      return {
        ok: true, status: 200,
        json: async () => [{ animal_id: 42, animal_name: "Cow", status: "breach", tag_serial: "TAG-0042", borrower_name: "R. Siddiqui", loan_number: "LN-9", branch_name: "Ridge" }],
      };
    });
    render(<GlobalSearch />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "siddiqui" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetchCalls).toContain("/api/search?q=siddiqui");
    const option = screen.getByRole("option");
    expect(option.textContent).toContain("TAG-0042");
    expect(option.textContent).toContain("R. Siddiqui");
    expect(option.textContent).toContain("LN-9");
    expect(option.textContent).toContain("Breach");
    fireEvent.mouseDown(option);
    expect(h.push).toHaveBeenCalledWith("/?animal=42");
    vi.useRealTimers();
  });

  it("says when nothing matches, and when the search fails (with a retry)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<GlobalSearch />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByText(/matches “zzz”/)).toBeTruthy();

    let ok = false;
    vi.stubGlobal("fetch", async () => (ok ? { ok: true, status: 200, json: async () => [] } : { ok: false, status: 500, json: async () => ({}) }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "boom" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByText("The search failed.")).toBeTruthy();
    ok = true;
    await act(async () => { fireEvent.click(screen.getByText("Try again")); await vi.advanceTimersByTimeAsync(300); });
    expect(screen.queryByText("The search failed.")).toBeNull();
    vi.useRealTimers();
  });
});

describe("stub and denied screens", () => {
  it("a coming-soon screen is an empty state with one action", () => {
    render(<ComingSoon title="Reports" description="Daily reports are coming." />);
    expect(screen.getByRole("heading", { name: "Reports" })).toBeTruthy();
    expect(screen.getByText("Daily reports are coming.")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("access denied explains and offers the way back", () => {
    render(<AccessDenied />);
    expect(screen.getByText(/don't have access/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to the Overview" }).getAttribute("href")).toBe("/");
  });
});
