import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toLiveEvent, type LiveEvent } from "../src/lib/realtime/events";
import { openLiveConnection, type ChannelLike, type LiveStatus } from "../src/lib/realtime/connection";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// ─── payload mapping ─────────────────────────────────────────────────────────────────────────────
const fixRow = (over: Record<string, unknown> = {}) => ({
  id: 7, organization_id: ORG, tag_id: 3, animal_id: 5, lat: 31.5, lon: 74.3,
  fixed_at: "2026-10-10T09:00:00+00:00", speed_kmh: 2.5, battery_pct: 80, ...over,
});
const alertRow = (over: Record<string, unknown> = {}) => ({
  id: 11, organization_id: ORG, animal_id: 5, type: "breach", severity: "critical", status: "new",
  title: "Left district boundary", detail: "0.25 km outside boundary", ...over,
});

describe("toLiveEvent", () => {
  it("maps a fix insert", () => {
    expect(toLiveEvent("fixes", { eventType: "INSERT", new: fixRow() }, ORG)).toEqual({
      kind: "fix",
      fix: { id: 7, animalId: 5, tagId: 3, lat: 31.5, lon: 74.3, fixedAt: "2026-10-10T09:00:00+00:00", speedKmh: 2.5, batteryPct: 80 },
    });
  });

  it("keeps missing speed and battery as null", () => {
    const e = toLiveEvent("fixes", { eventType: "INSERT", new: fixRow({ speed_kmh: null, battery_pct: undefined }) }, ORG);
    expect(e).toMatchObject({ kind: "fix", fix: { speedKmh: null, batteryPct: null } });
  });

  it("maps alert inserts and updates, with a null detail when absent", () => {
    expect(toLiveEvent("alerts", { eventType: "INSERT", new: alertRow() }, ORG)).toMatchObject({
      kind: "alert", op: "INSERT", alert: { id: 11, animalId: 5, type: "breach", severity: "critical", status: "new" },
    });
    expect(toLiveEvent("alerts", { eventType: "UPDATE", new: alertRow({ status: "acknowledged", detail: null }) }, ORG)).toMatchObject({
      kind: "alert", op: "UPDATE", alert: { status: "acknowledged", detail: null },
    });
  });

  it("maps an animal status update", () => {
    expect(toLiveEvent("animals", { eventType: "UPDATE", new: { id: 5, organization_id: ORG, status: "breach" } }, ORG)).toEqual({
      kind: "animal", animal: { id: 5, status: "breach" },
    });
  });

  it("drops every row of another organization, for every table", () => {
    expect(toLiveEvent("fixes", { eventType: "INSERT", new: fixRow({ organization_id: OTHER }) }, ORG)).toBeNull();
    expect(toLiveEvent("alerts", { eventType: "INSERT", new: alertRow({ organization_id: OTHER }) }, ORG)).toBeNull();
    expect(toLiveEvent("animals", { eventType: "UPDATE", new: { id: 5, organization_id: OTHER, status: "breach" } }, ORG)).toBeNull();
  });

  it("drops a row with no organization at all", () => {
    expect(toLiveEvent("fixes", { eventType: "INSERT", new: fixRow({ organization_id: undefined }) }, ORG)).toBeNull();
  });

  it("drops deletes, wrong change types, unknown tables and malformed rows", () => {
    expect(toLiveEvent("alerts", { eventType: "DELETE", new: undefined }, ORG)).toBeNull();
    expect(toLiveEvent("alerts", { eventType: "DELETE", new: alertRow() }, ORG)).toBeNull();
    expect(toLiveEvent("fixes", { eventType: "UPDATE", new: fixRow() }, ORG)).toBeNull();
    expect(toLiveEvent("animals", { eventType: "INSERT", new: { id: 1, organization_id: ORG, status: "inside" } }, ORG)).toBeNull();
    expect(toLiveEvent("borrowers", { eventType: "INSERT", new: { id: 1, organization_id: ORG } }, ORG)).toBeNull();
    expect(toLiveEvent("fixes", { eventType: "INSERT", new: fixRow({ lat: "31.5" }) }, ORG)).toBeNull();
    expect(toLiveEvent("fixes", { eventType: "INSERT", new: fixRow({ lat: Number.NaN }) }, ORG)).toBeNull();
    expect(toLiveEvent("alerts", { eventType: "INSERT", new: alertRow({ title: undefined }) }, ORG)).toBeNull();
    expect(toLiveEvent("fixes", { eventType: "INSERT", new: null }, ORG)).toBeNull();
  });
});

// ─── connection ──────────────────────────────────────────────────────────────────────────────────
interface FakeChannel extends ChannelLike {
  name: string;
  bindings: Array<{ filter: Record<string, string>; callback: (p: never) => void }>;
  statusCallback: ((status: string) => void) | null;
  removed: boolean;
}

function makeFakeClient() {
  const channels: FakeChannel[] = [];
  return {
    channels,
    client: {
      channel(name: string): ChannelLike {
        const ch: FakeChannel = {
          name, bindings: [], statusCallback: null, removed: false,
          on(_type, filter, callback) {
            ch.bindings.push({ filter, callback });
            return ch;
          },
          subscribe(callback) {
            ch.statusCallback = callback;
            return ch;
          },
        };
        channels.push(ch);
        return ch;
      },
      removeChannel(ch: ChannelLike) {
        (ch as FakeChannel).removed = true;
        return Promise.resolve("ok");
      },
    },
    latest: () => channels[channels.length - 1],
    /** Deliver a postgres_changes payload on a channel. */
    emit(ch: FakeChannel, table: string, payload: { eventType: string; new?: unknown }) {
      for (const b of ch.bindings) if (b.filter.table === table) b.callback(payload as never);
    },
  };
}

describe("openLiveConnection", () => {
  let fake: ReturnType<typeof makeFakeClient>;
  let events: LiveEvent[];
  let statuses: LiveStatus[];
  let resyncs: number;

  const open = (watchdogMs = 20_000) =>
    openLiveConnection({
      client: fake.client,
      organizationId: ORG,
      onEvent: (e) => events.push(e),
      onStatus: (s) => statuses.push(s),
      onResync: () => { resyncs++; },
      watchdogMs,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    fake = makeFakeClient();
    events = [];
    statuses = [];
    resyncs = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("subscribes to fixes, alerts and animals, each filtered to the active organization", () => {
    open();
    const ch = fake.latest();
    expect(ch.bindings.map((b) => [b.filter.table, b.filter.event])).toEqual([
      ["fixes", "INSERT"], ["alerts", "*"], ["animals", "UPDATE"],
    ]);
    for (const b of ch.bindings) {
      expect(b.filter).toMatchObject({ schema: "public", filter: `organization_id=eq.${ORG}` });
    }
  });

  it("refuses an organization id that is not a UUID (it goes into a filter string)", () => {
    for (const bad of ["", "abc", `${ORG},organization_id=eq.${OTHER}`, `${ORG}) or (1=1`]) {
      expect(() => openLiveConnection({ client: fake.client, organizationId: bad, onEvent() {}, onStatus() {}, onResync() {} })).toThrow(/invalid organization id/);
    }
    expect(fake.channels).toHaveLength(0);
  });

  it("starts as connecting and becomes live (with a resync) when subscribed", () => {
    open();
    expect(statuses).toEqual(["connecting"]);
    fake.latest().statusCallback!("SUBSCRIBED");
    expect(statuses).toEqual(["connecting", "live"]);
    expect(resyncs).toBe(1);
  });

  it("passes the active organization's events through and drops other organizations' rows", () => {
    open();
    const ch = fake.latest();
    ch.statusCallback!("SUBSCRIBED");
    fake.emit(ch, "fixes", { eventType: "INSERT", new: fixRow() });
    fake.emit(ch, "fixes", { eventType: "INSERT", new: fixRow({ id: 8, organization_id: OTHER }) });
    fake.emit(ch, "alerts", { eventType: "INSERT", new: alertRow({ organization_id: OTHER }) });
    expect(events.map((e) => e.kind)).toEqual(["fix"]);
  });

  it("goes to reconnecting on an error, and resyncs when it is live again", () => {
    open();
    const ch = fake.latest();
    ch.statusCallback!("SUBSCRIBED");
    ch.statusCallback!("CHANNEL_ERROR");
    expect(statuses).toEqual(["connecting", "live", "reconnecting"]);
    expect(resyncs).toBe(1);
    ch.statusCallback!("SUBSCRIBED"); // the client library rejoined by itself
    expect(statuses).toEqual(["connecting", "live", "reconnecting", "live"]);
    expect(resyncs).toBe(2); // refetch: events during the gap are never replayed
  });

  it("treats TIMED_OUT and CLOSED like an error", () => {
    open();
    const ch = fake.latest();
    ch.statusCallback!("SUBSCRIBED");
    ch.statusCallback!("TIMED_OUT");
    ch.statusCallback!("SUBSCRIBED");
    ch.statusCallback!("CLOSED");
    expect(statuses).toEqual(["connecting", "live", "reconnecting", "live", "reconnecting"]);
  });

  it("stays 'connecting' (not 'reconnecting') if the very first attempt fails", () => {
    open();
    fake.latest().statusCallback!("CHANNEL_ERROR");
    expect(statuses).toEqual(["connecting"]);
  });

  it("does not report the same status twice", () => {
    open();
    const ch = fake.latest();
    ch.statusCallback!("SUBSCRIBED");
    ch.statusCallback!("CHANNEL_ERROR");
    ch.statusCallback!("CHANNEL_ERROR");
    expect(statuses).toEqual(["connecting", "live", "reconnecting"]);
  });

  it("rebuilds the channel if it stays down past the watchdog, backing off each time", () => {
    open(1_000);
    const first = fake.latest();
    first.statusCallback!("SUBSCRIBED");
    first.statusCallback!("CHANNEL_ERROR");

    vi.advanceTimersByTime(999);
    expect(fake.channels).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(fake.channels).toHaveLength(2);
    expect(first.removed).toBe(true);

    const second = fake.latest();
    second.statusCallback!("CHANNEL_ERROR"); // still down: the next wait is doubled
    vi.advanceTimersByTime(1_999);
    expect(fake.channels).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(fake.channels).toHaveLength(3);

    fake.latest().statusCallback!("SUBSCRIBED");
    expect(statuses.at(-1)).toBe("live");
    expect(resyncs).toBe(2);
  });

  it("does not rebuild a channel that recovered on its own", () => {
    open(1_000);
    const ch = fake.latest();
    ch.statusCallback!("SUBSCRIBED");
    ch.statusCallback!("CHANNEL_ERROR");
    vi.advanceTimersByTime(500);
    ch.statusCallback!("SUBSCRIBED");
    vi.advanceTimersByTime(10_000);
    expect(fake.channels).toHaveLength(1);
  });

  it("ignores everything a replaced channel still says (no ghost events, no stale status)", () => {
    const conn = open(1_000);
    const old = fake.latest();
    old.statusCallback!("SUBSCRIBED");
    old.statusCallback!("CHANNEL_ERROR");
    vi.advanceTimersByTime(1_000); // watchdog rebuilds
    const fresh = fake.latest();
    fresh.statusCallback!("SUBSCRIBED");

    old.statusCallback!("CHANNEL_ERROR");
    fake.emit(old, "fixes", { eventType: "INSERT", new: fixRow() });
    expect(statuses.at(-1)).toBe("live");
    expect(events).toEqual([]);
    conn.close();
  });

  it("refresh() asks for a resync when live, and rebuilds the channel when it is down", () => {
    const conn = open();
    const ch = fake.latest();
    ch.statusCallback!("SUBSCRIBED");
    conn.refresh();
    expect(resyncs).toBe(2);
    expect(fake.channels).toHaveLength(1);

    ch.statusCallback!("CHANNEL_ERROR");
    conn.refresh();
    expect(fake.channels).toHaveLength(2);
    expect(ch.removed).toBe(true);
  });

  it("close() removes the channel, stops the watchdog and silences all callbacks", () => {
    const conn = open(1_000);
    const ch = fake.latest();
    ch.statusCallback!("SUBSCRIBED");
    ch.statusCallback!("CHANNEL_ERROR");
    conn.close();
    expect(ch.removed).toBe(true);

    vi.advanceTimersByTime(60_000);
    expect(fake.channels).toHaveLength(1); // no rebuild after close
    const before = { events: events.length, statuses: statuses.length, resyncs };
    ch.statusCallback!("SUBSCRIBED");
    fake.emit(ch, "fixes", { eventType: "INSERT", new: fixRow() });
    conn.refresh();
    expect({ events: events.length, statuses: statuses.length, resyncs }).toEqual(before);
  });
});
