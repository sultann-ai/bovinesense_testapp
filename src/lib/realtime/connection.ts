/**
 * One live subscription to the active organization's changes, with reconnect handling.
 *
 * Opens a Supabase Realtime channel with `postgres_changes` bindings on fixes, alerts and animals,
 * each filtered by `organization_id=eq.<active organization>` (Row Level Security decides what a
 * user actually receives; see supabase/migrations/…_realtime.sql).
 *
 *   status        "connecting"   first connection in progress
 *                 "live"         subscribed
 *                 "reconnecting" the channel errored, timed out or closed; the client library
 *                                rejoins by itself when the socket is back, and this module also
 *                                rebuilds the channel if it stays down (watchdog, with back-off)
 *   onResync()    called every time the subscription becomes live: on first connect AND after
 *                 every reconnect. Events that happened while it was down are never replayed by
 *                 Realtime, so the owner must refetch its state; this is what guarantees nothing
 *                 is missed.
 *
 * Pure TypeScript (the Supabase client is injected) so it is unit-tested with a fake client.
 */
import { LIVE_SUBSCRIPTIONS, toLiveEvent, type LiveEvent } from "./events";

export type LiveStatus = "connecting" | "live" | "reconnecting";

/** The parts of a Supabase Realtime channel this module uses. */
export interface ChannelLike {
  on(type: "postgres_changes", filter: Record<string, string>, callback: (payload: never) => void): ChannelLike;
  subscribe(callback: (status: string, err?: unknown) => void): ChannelLike;
}
/** The parts of the Supabase client this module uses. */
export interface ClientLike {
  channel(name: string): ChannelLike;
  removeChannel(channel: ChannelLike): unknown;
}

export interface LiveConnectionOptions {
  client: ClientLike;
  organizationId: string;
  onEvent: (event: LiveEvent) => void;
  onStatus: (status: LiveStatus) => void;
  onResync: () => void;
  /** How long a dropped channel may stay down before it is rebuilt. Doubles each time, up to a cap. */
  watchdogMs?: number;
}

export interface LiveConnection {
  /** Rebuild the channel now if it is down; otherwise just ask the owner to resync. */
  refresh(): void;
  close(): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_WATCHDOG_MS = 30_000;

export function openLiveConnection(opts: LiveConnectionOptions): LiveConnection {
  // The id goes into a filter string: refuse anything that is not a UUID.
  if (!UUID.test(opts.organizationId)) throw new Error("openLiveConnection: invalid organization id");

  const baseWatchdog = opts.watchdogMs ?? 20_000;
  let generation = 0;
  let channel: ChannelLike | null = null;
  let status: LiveStatus | null = null;
  let everLive = false;
  let closed = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let watchdogMs = baseWatchdog;

  const setStatus = (next: LiveStatus) => {
    if (status === next) return;
    status = next;
    opts.onStatus(next);
  };
  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };
  const dropChannel = () => {
    if (!channel) return;
    const old = channel;
    channel = null;
    generation++; // callbacks of the old channel are ignored from now on
    try {
      void Promise.resolve(opts.client.removeChannel(old)).catch(() => {});
    } catch { /* already gone */ }
  };

  function armWatchdog() {
    if (watchdog || closed) return;
    watchdog = setTimeout(() => {
      watchdog = null;
      if (closed || status === "live") return;
      watchdogMs = Math.min(watchdogMs * 2, MAX_WATCHDOG_MS);
      dropChannel();
      connect();
    }, watchdogMs);
  }

  function connect() {
    if (closed) return;
    const mine = ++generation;
    const filter = `organization_id=eq.${opts.organizationId}`;
    let ch = opts.client.channel(`live:${opts.organizationId}:${mine}`);
    for (const { table, event } of LIVE_SUBSCRIPTIONS) {
      ch = ch.on("postgres_changes", { event, schema: "public", table, filter }, ((payload: Parameters<typeof toLiveEvent>[1]) => {
        if (closed || mine !== generation) return;
        const live = toLiveEvent(table, payload, opts.organizationId);
        if (live) opts.onEvent(live);
      }) as (payload: never) => void);
    }
    channel = ch;
    ch.subscribe((s) => {
      if (closed || mine !== generation) return;
      if (s === "SUBSCRIBED") {
        everLive = true;
        clearWatchdog();
        watchdogMs = baseWatchdog;
        setStatus("live");
        opts.onResync();
      } else {
        // CHANNEL_ERROR, TIMED_OUT or CLOSED: the client library rejoins by itself once the socket is
        // back; the watchdog rebuilds the channel if that does not happen.
        setStatus(everLive ? "reconnecting" : "connecting");
        armWatchdog();
      }
    });
  }

  setStatus("connecting");
  connect();

  return {
    refresh() {
      if (closed) return;
      if (status === "live") {
        opts.onResync();
        return;
      }
      clearWatchdog();
      dropChannel();
      connect();
    },
    close() {
      if (closed) return;
      closed = true;
      clearWatchdog();
      dropChannel();
    },
  };
}
