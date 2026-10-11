// @vitest-environment jsdom
/**
 * The trail controls: useTrail (loading, window change, playback) driving the real TrailPanel.
 * Fetch is replaced with a canned response; time is faked so playback steps are deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useTrail } from "../src/components/map/useTrail";
import { TrailPanel } from "../src/components/map/TrailPanel";
import { PLAYBACK_INTERVAL_MS, type TrailHours } from "../src/lib/maps/trail";

const feature = (id: number, minutesAgo: number, speed: number | null = null) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [74.3 + id * 0.01, 31.5] },
  properties: { id, fixed_at: new Date(Date.UTC(2026, 9, 8, 12, 0) - minutesAgo * 60_000).toISOString(), speed_kmh: speed, battery_pct: 80 },
});
// Deliberately out of order: the panel must show them oldest to newest.
const FIVE = { type: "FeatureCollection", features: [feature(3, 60), feature(1, 240), feature(5, 0, 12.5), feature(2, 180), feature(4, 120)] };

let requested: string[];
let respond: (url: string) => { ok: boolean; body: unknown };

function Harness({ animalId = 7 }: { animalId?: number | null }) {
  const [hours, setHours] = useState<TrailHours>(24);
  const trail = useTrail(animalId, hours);
  return <TrailPanel trail={trail} hours={hours} onHoursChange={setHours} onClose={() => {}} />;
}

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

beforeEach(() => {
  vi.useFakeTimers();
  requested = [];
  respond = () => ({ ok: true, body: FIVE });
  vi.stubGlobal("fetch", async (url: string) => {
    requested.push(url);
    const r = respond(url);
    return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => r.body };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const slider = () => screen.getByTestId("trail-slider") as HTMLInputElement;

describe("loading", () => {
  it("asks for the animal's 24 h trail without caching, and shows a loading note first", async () => {
    render(<Harness />);
    expect(screen.getByText("Loading the trail…")).toBeTruthy();
    await settle();
    expect(requested).toEqual(["/api/animals/7/trail?hours=24"]);
    expect(screen.queryByText("Loading the trail…")).toBeNull();
  });

  it("rests on the newest fix, with the slider spanning every fix, oldest to newest", async () => {
    render(<Harness />);
    await settle();
    expect(slider().max).toBe("4");
    expect(slider().value).toBe("4");
    expect(screen.getByTestId("trail-position").textContent).toBe("5 / 5");
    expect(screen.getByTestId("trail-readout").textContent).toContain("12.5 km/h");
  });

  it("says so when there are no fixes in the window", async () => {
    respond = () => ({ ok: true, body: { type: "FeatureCollection", features: [] } });
    render(<Harness />);
    await settle();
    expect(screen.getByTestId("trail-empty").textContent).toContain("No fixes in the last 24 h");
    expect(screen.queryByTestId("trail-slider")).toBeNull();
  });

  it("says so when the trail cannot be loaded", async () => {
    respond = () => ({ ok: false, body: {} });
    render(<Harness />);
    await settle();
    expect(screen.getByText("The trail could not be loaded.")).toBeTruthy();
  });

  it("switching to 7 days fetches that window and starts clean", async () => {
    render(<Harness />);
    await settle();
    fireEvent.click(screen.getByTestId("trail-window-168"));
    expect(screen.getByText("Loading the trail…")).toBeTruthy();
    await settle();
    expect(requested).toEqual(["/api/animals/7/trail?hours=24", "/api/animals/7/trail?hours=168"]);
    expect(screen.getByTestId("trail-window-168").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("scrubbing and playback", () => {
  it("dragging the slider moves the readout to that fix, and notes the gap since the one before", async () => {
    render(<Harness />);
    await settle();
    fireEvent.change(slider(), { target: { value: "2" } });
    expect(screen.getByTestId("trail-position").textContent).toBe("3 / 5");
    expect(screen.getByTestId("trail-readout").textContent).toContain("60 min since the previous fix");
  });

  it("play from the newest restarts at the oldest, then steps fix by fix and stops on the newest", async () => {
    render(<Harness />);
    await settle();
    fireEvent.click(screen.getByTestId("trail-play"));
    expect(slider().value).toBe("0");
    for (const expected of ["1", "2", "3", "4"]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(PLAYBACK_INTERVAL_MS); });
      expect(slider().value).toBe(expected);
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAYBACK_INTERVAL_MS); });
    expect(slider().value).toBe("4");
    expect(screen.getByTestId("trail-play").getAttribute("aria-label")).toBe("Play from the start"); // stopped
  });

  it("pausing holds the playhead where it is", async () => {
    render(<Harness />);
    await settle();
    fireEvent.click(screen.getByTestId("trail-play"));
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAYBACK_INTERVAL_MS * 2); });
    expect(slider().value).toBe("2");
    fireEvent.click(screen.getByTestId("trail-play")); // pause
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAYBACK_INTERVAL_MS * 3); });
    expect(slider().value).toBe("2");
  });

  it("touching the slider while playing stops playback", async () => {
    render(<Harness />);
    await settle();
    fireEvent.click(screen.getByTestId("trail-play"));
    fireEvent.change(slider(), { target: { value: "3" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(PLAYBACK_INTERVAL_MS * 2); });
    expect(slider().value).toBe("3");
  });

  it("a single fix cannot be played", async () => {
    respond = () => ({ ok: true, body: { type: "FeatureCollection", features: [feature(1, 0)] } });
    render(<Harness />);
    await settle();
    expect((screen.getByTestId("trail-play") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("trail-position").textContent).toBe("1 / 1");
  });
});

describe("no animal", () => {
  it("makes no request", async () => {
    render(<Harness animalId={null} />);
    await settle();
    expect(requested).toEqual([]);
  });
});
