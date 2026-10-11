// @vitest-environment jsdom
/**
 * The twelve components of DESIGN.md §8 (src/components/ui): what each one renders and does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  AlertFeedItem, AnimalDrawerFrame, BatteryGlyph, Button, DataTable, EmptyState, ErrorState, FilterBar, KpiCard, MapPopup,
  SignalGlyph, Skeleton, SkeletonLines, StatusPill, Timestamp, Toast, ToastStack, TOAST_DURATION_MS,
  type Column, type FeedAlert, type ToastItem,
} from "../src/components/ui";
import { TenantProvider } from "../src/components/shell/TenantProvider";

afterEach(cleanup);

const NOW = Date.parse("2026-10-08T12:00:00Z");
beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("Button", () => {
  it("has the four variants", () => {
    render(<><Button variant="primary">P</Button><Button variant="secondary">S</Button><Button variant="ghost">G</Button><Button variant="destructive">D</Button></>);
    expect(screen.getByText("P").className).toContain("bg-brand");
    expect(screen.getByText("S").className).toContain("border-text-primary");
    expect(screen.getByText("G").className).toContain("bg-transparent");
    expect(screen.getByText("D").className).toContain("bg-status-breach");
  });

  it("is 36 px tall with a 6 px radius, and square for icon-only", () => {
    render(<><Button>Go</Button><Button size="icon" aria-label="x" /></>);
    expect(screen.getByText("Go").className).toContain("h-9");
    expect(screen.getByText("Go").className).toContain("rounded-[var(--radius-sm)]");
    expect(screen.getByLabelText("x").className).toContain("w-9");
  });

  it("is a type=button unless told otherwise (it never submits a form by accident)", () => {
    render(<Button>Go</Button>);
    expect(screen.getByText("Go").getAttribute("type")).toBe("button");
  });

  it("busy disables it and says so", () => {
    const onClick = vi.fn();
    render(<Button busy onClick={onClick}>Save</Button>);
    const b = screen.getByText("Save") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("StatusPill", () => {
  it.each([
    ["inside", "Inside boundary"], ["near", "Near boundary"], ["breach", "Breach"], ["fast", "Fast movement"], ["stale", "Offline"],
  ])("%s is an icon AND the word %s", (status, word) => {
    const { container } = render(<StatusPill status={status} />);
    expect(screen.getByText(word)).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("is fully round, tinted, with a 14 px icon", () => {
    const { container } = render(<StatusPill status="breach" />);
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.className).toContain("rounded-full");
    expect(pill.className).toContain("bg-status-breach-tint");
    expect(pill.className).toContain("text-status-breach");
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("14");
  });

  it("reads an unknown status as offline, never as healthy", () => {
    render(<StatusPill status="something-new" />);
    expect(screen.getByText("Offline")).toBeTruthy();
  });
});

describe("KpiCard", () => {
  it("shows the label, the value and the caption", () => {
    render(<KpiCard label="Animals tracked" value="240" caption="tags active" />);
    expect(screen.getByText("Animals tracked")).toBeTruthy();
    expect(screen.getByText("240").className).toContain("tabular-nums");
    expect(screen.getByText("tags active")).toBeTruthy();
  });

  it("the breach card gets a crimson top bar only while alerting", () => {
    const { rerender } = render(<KpiCard label="Active breaches" value="2" alert />);
    expect(screen.queryByTestId("kpi-alert-bar")).toBeTruthy();
    expect(screen.getByText("2").className).toContain("text-status-breach");
    rerender(<KpiCard label="Active breaches" value="0" alert={false} />);
    expect(screen.queryByTestId("kpi-alert-bar")).toBeNull();
  });

  it("shows a delta in green when the change is good and crimson when it is bad", () => {
    const { rerender } = render(<KpiCard label="x" value="1" delta={{ value: 3, upIsGood: true }} />);
    expect(screen.getByTestId("kpi-delta").className).toContain("text-status-inside");
    expect(screen.getByTestId("kpi-delta").textContent).toContain("3 vs yesterday");
    rerender(<KpiCard label="x" value="1" delta={{ value: 3, upIsGood: false }} />);
    expect(screen.getByTestId("kpi-delta").className).toContain("text-status-breach");
    rerender(<KpiCard label="x" value="1" delta={{ value: 0, upIsGood: true }} />);
    expect(screen.queryByTestId("kpi-delta")).toBeNull();
  });

  it("shows a skeleton, not a stale number, while loading", () => {
    render(<KpiCard label="x" value="99" loading />);
    expect(screen.queryByText("99")).toBeNull();
  });
});

describe("Timestamp", () => {
  const wrap = (ui: React.ReactElement, timezone = "Asia/Karachi") => (
    <TenantProvider value={{ name: "T", logoUrl: null, timezone, offlineThresholdHours: 6 }}>{ui}</TenantProvider>
  );

  it("shows relative text with the exact time in the tenant's timezone on hover", () => {
    render(wrap(<Timestamp value="2026-10-08T11:37:00Z" />));
    const el = screen.getByText("23 min ago");
    expect(el.getAttribute("title")).toBe("08 Oct 2026, 16:37 PKT");
    render(wrap(<Timestamp value="2026-10-08T11:37:00Z" />, "UTC"));
    expect(screen.getAllByText("23 min ago")[1].getAttribute("title")).toBe("08 Oct 2026, 11:37 UTC");
  });

  it("turns grey with a clock icon once stale", () => {
    const { container } = render(wrap(<Timestamp value="2026-10-08T03:00:00Z" staleAfterHours={6} />));
    const el = container.querySelector("time") as HTMLElement;
    expect(el.dataset.stale).toBe("true");
    expect(el.className).toContain("text-status-stale");
    expect(el.querySelector("svg")).toBeTruthy();
  });

  it("is not stale inside the threshold", () => {
    const { container } = render(wrap(<Timestamp value="2026-10-08T11:00:00Z" staleAfterHours={6} />));
    expect(container.querySelector("time")?.dataset.stale).toBe("false");
  });

  it("says so when there is no value, and counts that as stale when a threshold applies", () => {
    const { container } = render(wrap(<Timestamp value={null} staleAfterHours={6} empty="No fix" />));
    expect(screen.getByText("No fix")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("Battery and signal", () => {
  it.each([[100, 4], [80, 4], [60, 3], [30, 2], [20, 1], [5, 1], [0, 0]])("battery %i%% fills %i of 4 bars", (pct, bars) => {
    const { container } = render(<BatteryGlyph pct={pct} />);
    const filled = container.querySelectorAll('[role="img"] > span:not(.bg-border)').length;
    expect(filled).toBe(bars);
  });

  it("gives the exact value on hover and to screen readers", () => {
    render(<BatteryGlyph pct={62} />);
    const glyph = screen.getByRole("img");
    expect(glyph.getAttribute("title")).toBe("Battery 62%");
    expect(glyph.getAttribute("aria-label")).toBe("Battery 62%");
    expect(screen.getByText("62%")).toBeTruthy();
  });

  it("goes grey, amber, red as it drains", () => {
    const tone = (pct: number) => {
      const { container, unmount } = render(<BatteryGlyph pct={pct} />);
      const cls = container.querySelector('[role="img"] > span')!.className;
      unmount();
      return cls;
    };
    expect(tone(90)).toContain("bg-status-stale");
    expect(tone(40)).toContain("bg-status-near");
    expect(tone(10)).toContain("bg-status-breach");
  });

  it("shows a dash when unknown", () => {
    render(<><BatteryGlyph pct={null} /><SignalGlyph bars={undefined} /></>);
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("signal is 0-4 bars with its value on hover", () => {
    render(<SignalGlyph bars={3} />);
    expect(screen.getByRole("img").getAttribute("title")).toBe("Signal 3 of 4 bars");
  });
});

describe("Loading, empty and error states", () => {
  it("empty is one sentence and one action", () => {
    const onClick = vi.fn();
    render(<EmptyState title="Nothing here yet." action={{ label: "Add one", onClick }} />);
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add one" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("empty can link instead", () => {
    render(<EmptyState title="Nothing." action={{ label: "Go", href: "/alerts" }} />);
    expect(screen.getByRole("link", { name: "Go" }).getAttribute("href")).toBe("/alerts");
  });

  it("error says what failed and offers a retry", () => {
    const onRetry = vi.fn();
    render(<ErrorState what="The alerts could not be loaded." onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("The alerts could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("the compact error has the same retry", () => {
    const onRetry = vi.fn();
    render(<ErrorState compact what="Failed." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("loading is shape, not motion: no shimmer or pulse animation", () => {
    const { container } = render(<><Skeleton className="h-4" /><SkeletonLines rows={3} /></>);
    expect(container.innerHTML).not.toMatch(/animate-|shimmer/);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});

describe("DataTable", () => {
  interface Row { id: number; tag: string }
  const columns: Column<Row>[] = [{ key: "tag", header: "Tag ID", cell: (r) => r.tag }];
  const rows: Row[] = [{ id: 1, tag: "SIM-1" }, { id: 2, tag: "SIM-2" }];
  const base = { columns, rows, getRowId: (r: Row) => r.id, label: "Animals", empty: <EmptyState title="No rows." /> };

  it("has 48 px rows and a sticky header on the sunken background", () => {
    const { container } = render(<DataTable {...base} />);
    expect(container.querySelector("tbody tr")?.className).toContain("h-12");
    const th = container.querySelector("th")!;
    expect(th.className).toContain("sticky");
    expect(th.className).toContain("bg-bg-sunken");
  });

  it("highlights the selected row with the brand tint and no zebra", () => {
    const { container } = render(<DataTable {...base} selectedId={2} />);
    const trs = container.querySelectorAll("tbody tr");
    expect(trs[1].className).toContain("bg-brand-tint");
    expect(trs[0].className).not.toContain("bg-brand-tint");
    expect(trs[0].className).toContain("hover:bg-bg-sunken");
    expect(container.innerHTML).not.toMatch(/odd:|even:/);
  });

  it("calls back on a row click and on Enter", () => {
    const onRowClick = vi.fn();
    render(<DataTable {...base} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText("SIM-1"));
    fireEvent.keyDown(screen.getByText("SIM-2").closest("tr")!, { key: "Enter" });
    expect(onRowClick.mock.calls.map((c) => c[0].id)).toEqual([1, 2]);
  });

  it("puts a locate-on-map icon button at the end of each row, which does not select the row", () => {
    const onRowClick = vi.fn();
    const onLocate = vi.fn();
    render(<DataTable {...base} onRowClick={onRowClick} onLocate={onLocate} />);
    const buttons = screen.getAllByRole("button", { name: "Locate on map" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(onLocate).toHaveBeenCalledWith(rows[1]);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("shows skeleton rows while loading", () => {
    render(<DataTable {...base} loading skeletonRows={4} />);
    expect(screen.getAllByTestId("skeleton-row")).toHaveLength(4);
    expect(screen.queryByText("SIM-1")).toBeNull();
  });

  it("shows the empty state when there are no rows", () => {
    render(<DataTable {...base} rows={[]} />);
    expect(screen.getByText("No rows.")).toBeTruthy();
  });

  it("shows the error state with a retry instead of rows", () => {
    const onRetry = vi.fn();
    render(<DataTable {...base} error={{ what: "The animals could not be loaded.", onRetry }} />);
    expect(screen.queryByText("SIM-1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("supports a checkbox column for bulk actions", () => {
    const onToggle = vi.fn();
    const onToggleAll = vi.fn();
    render(<DataTable {...base} selection={{ checked: new Set([1]), onToggle, onToggleAll }} />);
    expect((screen.getByLabelText("Select row 1") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Select row 2"));
    expect(onToggle).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByLabelText("Select all"));
    expect(onToggleAll).toHaveBeenCalled();
  });
});

describe("FilterBar", () => {
  const make = (value: string | null, onChange = vi.fn()) => ({
    groups: [{ key: "status", label: "Status", options: [{ value: "breach", label: "Breach" }, { value: "stale", label: "Offline" }], value, onChange }],
  });

  it("marks the active chip, in brand tint with terracotta text", () => {
    render(<FilterBar {...make("breach")} />);
    const chip = screen.getByRole("button", { name: "Breach" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(chip.className).toContain("bg-brand-tint");
    expect(chip.className).toContain("text-brand-hover");
    expect(screen.getByRole("button", { name: "Offline" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("selects a chip, and unsets it when clicked again", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterBar {...make(null, onChange)} />);
    fireEvent.click(screen.getByRole("button", { name: "Offline" }));
    expect(onChange).toHaveBeenLastCalledWith("stale");
    rerender(<FilterBar {...make("stale", onChange)} />);
    fireEvent.click(screen.getByRole("button", { name: /Offline/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("shows Clear all (a ghost button) only when something is active, and clears every group at once", () => {
    const onClearAll = vi.fn();
    const { rerender } = render(<FilterBar {...make(null)} onClearAll={onClearAll} />);
    expect(screen.queryByText("Clear all")).toBeNull();
    rerender(<FilterBar {...make("breach")} onClearAll={onClearAll} />);
    fireEvent.click(screen.getByText("Clear all"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});

describe("AlertFeedItem", () => {
  const alert: FeedAlert = {
    id: 5, type: "breach", status: "new", title: "Left Lahore district", detail: "14.2 km outside boundary",
    created_at: "2026-10-08T11:30:00Z", animal_id: 9, tag_serial: "SIM-00009", borrower_name: "A. Khan", loan_number: "LN-1", branch_name: "Gulberg",
  };
  const handlers = () => ({ onOpen: vi.fn(), onAcknowledge: vi.fn(), onLocate: vi.fn() });

  it("shows the title, the tag / borrower / loan line in mono, the branch and the fact that matters", () => {
    const h = handlers();
    render(<AlertFeedItem alert={alert} selected={false} canAcknowledge {...h} />);
    expect(screen.getByText("Left Lahore district")).toBeTruthy();
    const line = screen.getByText("SIM-00009 · A. Khan · LN-1");
    expect(line.className).toContain("font-mono-ids");
    expect(screen.getByText(/Gulberg · 14.2 km outside boundary/)).toBeTruthy();
  });

  it("has a 4 px severity bar and an unread dot while new", () => {
    const h = handlers();
    const { container, rerender } = render(<AlertFeedItem alert={alert} selected={false} canAcknowledge {...h} />);
    expect(container.querySelector(".w-1.bg-status-breach")).toBeTruthy();
    expect(screen.getByTestId("unread-dot")).toBeTruthy();
    rerender(<AlertFeedItem alert={{ ...alert, status: "acknowledged" }} selected={false} canAcknowledge {...h} />);
    expect(screen.queryByTestId("unread-dot")).toBeNull();
  });

  it("offers Acknowledge only to someone who may, and only while new", () => {
    const h = handlers();
    const { rerender } = render(<AlertFeedItem alert={alert} selected={false} canAcknowledge={false} {...h} />);
    expect(screen.queryByText("Acknowledge")).toBeNull();
    rerender(<AlertFeedItem alert={alert} selected={false} canAcknowledge {...h} />);
    fireEvent.click(screen.getByText("Acknowledge"));
    expect(h.onAcknowledge).toHaveBeenCalledWith(5);
    rerender(<AlertFeedItem alert={{ ...alert, status: "assigned" }} selected={false} canAcknowledge {...h} />);
    expect(screen.queryByText("Acknowledge")).toBeNull();
  });

  it("View on map and Open act on the animal", () => {
    const h = handlers();
    render(<AlertFeedItem alert={alert} selected canAcknowledge {...h} />);
    fireEvent.click(screen.getByText("View on map"));
    fireEvent.click(screen.getByText("Open"));
    expect(h.onLocate).toHaveBeenCalledWith(9);
    expect(h.onOpen).toHaveBeenCalledWith(9);
    expect(screen.getByTestId("alert-feed-item").className).toContain("bg-brand-tint");
  });
});

describe("Toast", () => {
  const toast: ToastItem = { id: "t1", alertType: "breach", severity: "critical", title: "Breach: SIM-1", animalId: 4, detail: "Left the district" };

  it("is 360 px wide with a severity bar and one action, View", () => {
    const { container } = render(<Toast toast={toast} onDismiss={vi.fn()} onView={vi.fn()} />);
    expect(screen.getByTestId("toast").className).toContain("w-[360px]");
    expect(container.querySelector(".w-1.bg-status-breach")).toBeTruthy();
    expect(screen.getAllByRole("button").map((b) => b.textContent || b.getAttribute("aria-label"))).toEqual(["View", "Dismiss"]);
  });

  it("View opens the animal", () => {
    const onView = vi.fn();
    render(<Toast toast={toast} onDismiss={vi.fn()} onView={onView} />);
    fireEvent.click(screen.getByText("View"));
    expect(onView).toHaveBeenCalledWith(4);
  });

  it("dismisses itself after 8 seconds, not before", () => {
    const onDismiss = vi.fn();
    render(<Toast toast={toast} onDismiss={onDismiss} onView={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(TOAST_DURATION_MS - 1); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledWith("t1");
    expect(TOAST_DURATION_MS).toBe(8000);
  });

  it("the stack renders nothing when empty, and sits top right", () => {
    const { container, rerender } = render(<ToastStack toasts={[]} onDismiss={vi.fn()} onView={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    rerender(<ToastStack toasts={[toast]} onDismiss={vi.fn()} onView={vi.fn()} />);
    expect((container.firstChild as HTMLElement).className).toContain("right-4");
  });
});

describe("MapPopup", () => {
  const animal = { tagSerial: "SIM-00002", animalName: "Cow", borrowerName: "B. Ahmad", lastFixAt: "2026-10-08T11:00:00Z", status: "breach" };
  const wrap = (ui: React.ReactElement) => (
    <TenantProvider value={{ name: "T", logoUrl: null, timezone: "Asia/Karachi", offlineThresholdHours: 6 }}>{ui}</TenantProvider>
  );

  it("is 280 px and shows the tag, borrower, status and last fix", () => {
    render(wrap(<MapPopup animal={animal} staleAfterHours={6} onOpenDetails={vi.fn()} onClose={vi.fn()} />));
    expect(screen.getByTestId("map-popup").className).toContain("w-[280px]");
    expect(screen.getByText("SIM-00002")).toBeTruthy();
    expect(screen.getByText("B. Ahmad")).toBeTruthy();
    expect(screen.getByText("Breach")).toBeTruthy();
    expect(screen.getByText("1 h ago")).toBeTruthy();
  });

  it("Open details and close are wired", () => {
    const onOpenDetails = vi.fn();
    const onClose = vi.fn();
    render(wrap(<MapPopup animal={animal} staleAfterHours={6} onOpenDetails={onOpenDetails} onClose={onClose} />));
    fireEvent.click(screen.getByText("Open details"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onOpenDetails).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("falls back to the animal's name, then to Unassigned", () => {
    const { rerender } = render(wrap(<MapPopup animal={{ ...animal, borrowerName: null }} staleAfterHours={6} onOpenDetails={vi.fn()} onClose={vi.fn()} />));
    expect(screen.getByText("Cow")).toBeTruthy();
    rerender(wrap(<MapPopup animal={{ ...animal, borrowerName: null, animalName: null }} staleAfterHours={6} onOpenDetails={vi.fn()} onClose={vi.fn()} />));
    expect(screen.getByText("Unassigned")).toBeTruthy();
  });
});

describe("AnimalDrawerFrame", () => {
  const frame = (over: Partial<React.ComponentProps<typeof AnimalDrawerFrame>> = {}) => {
    const props = { open: true, tagSerial: "SIM-00001", status: "inside", onClose: vi.fn(), miniMap: <div data-testid="mini" />, tab: "location" as const, onTabChange: vi.fn(), ...over };
    render(<AnimalDrawerFrame {...props}><p>panel</p></AnimalDrawerFrame>);
    return props;
  };

  it("is 420 px, on the right, rounded on its left edge", () => {
    frame();
    const d = screen.getByTestId("animal-drawer");
    expect(d.className).toContain("w-[420px]");
    expect(d.className).toContain("right-0");
    expect(d.className).toContain("rounded-l-[var(--radius-lg)]");
  });

  it("header: tag ID in mono, status pill, close", () => {
    const p = frame();
    expect(screen.getByText("SIM-00001").className).toContain("font-mono-ids");
    expect(screen.getByText("Inside boundary")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close details"));
    expect(p.onClose).toHaveBeenCalled();
  });

  it("has the mini map and the four tabs", () => {
    const p = frame();
    expect(screen.getByTestId("mini")).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Location", "Borrower and loan", "Tag health", "Events"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tabs[2]);
    expect(p.onTabChange).toHaveBeenCalledWith("tag");
  });

  it("slides out of view (and out of the accessibility tree) when closed", () => {
    frame({ open: false });
    const d = screen.getByTestId("animal-drawer");
    expect(d.dataset.open).toBe("false");
    expect(d.className).toContain("translate-x-full");
    expect(d.getAttribute("aria-hidden")).toBe("true");
  });

  it("says Loading… until it has a tag ID", () => {
    frame({ tagSerial: null, status: null });
    expect(within(screen.getByTestId("animal-drawer")).getByText("Loading…")).toBeTruthy();
  });
});
