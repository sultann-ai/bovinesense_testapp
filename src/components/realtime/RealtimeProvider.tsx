"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { openLiveConnection, type ClientLike, type LiveConnection, type LiveStatus } from "@/lib/realtime/connection";
import type { LiveEvent } from "@/lib/realtime/events";
import type { KpiData } from "@/components/overview/KpiStrip";
import { ToastStack, type ToastItem } from "@/components/ui/toast";
import { useScope } from "@/components/shell/ScopeProvider";

/**
 * The one live subscription of the signed-in shell (mounted in src/app/(app)/layout.tsx).
 *
 * It subscribes to Supabase Realtime `postgres_changes` on fixes, alerts and animals, filtered to
 * the active organization (Row Level Security decides what the user actually receives), and shares:
 *   - `status`          "connecting" | "live" | "reconnecting", shown in the top bar
 *   - `kpi`, `newAlertCount`   the KPI numbers; the bell and the sidebar badge read the same value
 *   - toasts            for new critical / warning alerts, on every screen
 *   - `subscribe`       so screens can patch their own state from each event (marker positions, feed)
 *   - `resyncVersion`   bumped on first connect and after EVERY reconnect: screens refetch, because
 *                       Realtime never replays what happened while the connection was down.
 */

interface LiveValue {
  status: LiveStatus;
  resyncVersion: number;
  kpi: KpiData | null;
  kpiLoading: boolean;
  /** Open alerts (new or acknowledged): the number on the bell and the sidebar badge. */
  newAlertCount: number;
  refreshKpi: () => void;
  subscribe: (listener: (event: LiveEvent) => void) => () => void;
}

const noop = () => {};
const LiveContext = createContext<LiveValue>({
  status: "connecting",
  resyncVersion: 0,
  kpi: null,
  kpiLoading: true,
  newAlertCount: 0,
  refreshKpi: noop,
  subscribe: () => noop,
});

export function useLive(): LiveValue {
  return useContext(LiveContext);
}

/** Run `handler` for every live event. Always calls the latest handler; subscribes once. */
export function useLiveEvents(handler: (event: LiveEvent) => void): void {
  const { subscribe } = useLive();
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}

/**
 * Run `handler` whenever the live connection (re)synchronises after this component mounted: on the
 * first connect (events between the component's own first fetch and the subscription would
 * otherwise be missed) and after every reconnect.
 */
export function useResync(handler: () => void): void {
  const { resyncVersion } = useLive();
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  const seen = useRef(resyncVersion);
  useEffect(() => {
    if (resyncVersion === seen.current) return;
    seen.current = resyncVersion;
    ref.current();
  }, [resyncVersion]);
}

const KPI_DEBOUNCE_MS = 600;
const LONG_HIDDEN_MS = 30_000;
const MAX_TOASTS = 5;

export function RealtimeProvider({ organizationId, children }: { organizationId: string; children: React.ReactNode }) {
  const router = useRouter();
  const scope = useScope();
  // Read by long-lived callbacks (the subscription) without re-creating the connection when it changes.
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; });
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [resyncVersion, setResyncVersion] = useState(0);
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const listeners = useRef(new Set<(event: LiveEvent) => void>());
  const statusRef = useRef<LiveStatus>("connecting");
  const kpiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchKpi = useCallback(async () => {
    try {
      const res = await fetch(scopeRef.current.scoped("/api/kpi"), { cache: "no-store" });
      if (res.ok) setKpi(await res.json());
    } catch { /* offline: the indicator already says so */ }
    finally { setKpiLoading(false); }
  }, []);

  // KPI numbers are aggregates, so changes are coalesced into one refetch.
  const refreshKpi = useCallback(() => {
    if (kpiTimer.current) clearTimeout(kpiTimer.current);
    kpiTimer.current = setTimeout(() => { kpiTimer.current = null; void fetchKpi(); }, KPI_DEBOUNCE_MS);
  }, [fetchKpi]);

  // The KPI numbers (and so the bell and the sidebar badge) follow the scope selector.
  const scopeKey = scope.key;
  useEffect(() => {
    void fetchKpi();
  }, [scopeKey, fetchKpi]);

  const subscribe = useCallback((listener: (event: LiveEvent) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let connection: LiveConnection | null = null;
    let hiddenAt: number | null = null;

    const handleEvent = (event: LiveEvent) => {
      listeners.current.forEach((l) => l(event));

      if (event.kind === "alert" || event.kind === "animal") refreshKpi();

      // A new critical or warning alert is worth interrupting for, on whichever screen the user is.
      if (event.kind === "alert" && event.op === "INSERT" && event.alert.status === "new"
          && (event.alert.severity === "critical" || event.alert.severity === "warning")) {
        const a = event.alert;
        const toast: ToastItem = {
          id: `${a.id}-${Date.now()}`,
          alertType: a.type,
          severity: a.severity,
          title: a.title,
          animalId: a.animalId,
          detail: a.detail ?? undefined,
        };
        const show = () => setToasts((prev) => [toast, ...prev.slice(0, MAX_TOASTS - 1)]);
        const sel = scopeRef.current.selection;
        if (sel.regionId === null && sel.branchId === null) {
          show();
        } else {
          // An alert carries no region or branch, so ask the (scoped) feed whether it belongs to the
          // part of the organization the user is looking at; out-of-scope alerts do not interrupt.
          void fetch(scopeRef.current.scoped("/api/alerts/feed?status=new"), { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : []))
            .then((rows: Array<{ id: number }>) => { if (Array.isArray(rows) && rows.some((r) => r.id === a.id)) show(); })
            .catch(() => {});
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      // Coming back to a tab that slept: rebuild if the connection is down, otherwise refetch,
      // because a throttled background tab may have missed events without noticing.
      if (statusRef.current !== "live" || away >= LONG_HIDDEN_MS) connection?.refresh();
    };
    const onOnline = () => { if (statusRef.current !== "live") connection?.refresh(); };

    (async () => {
      const client = createClient();
      // Makes sure the client has loaded (and refreshed, if needed) the session before the socket
      // opens; later token refreshes are forwarded to Realtime by supabase-js itself.
      await client.auth.getSession();
      if (cancelled) return;
      connection = openLiveConnection({
        client: client as unknown as ClientLike,
        organizationId,
        onEvent: handleEvent,
        onStatus: (s) => { statusRef.current = s; setStatus(s); },
        onResync: () => { setResyncVersion((v) => v + 1); void fetchKpi(); },
      });
    })();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      connection?.close();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      if (kpiTimer.current) clearTimeout(kpiTimer.current);
    };
  }, [organizationId, fetchKpi, refreshKpi]);

  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const viewAnimal = useCallback((animalId: number) => router.push(`/?animal=${animalId}`), [router]);

  const value = useMemo<LiveValue>(
    () => ({
      status, resyncVersion, kpi, kpiLoading,
      newAlertCount: kpi?.new_alerts ?? 0,
      refreshKpi, subscribe,
    }),
    [status, resyncVersion, kpi, kpiLoading, refreshKpi, subscribe],
  );

  return (
    <LiveContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} onView={viewAnimal} />
    </LiveContext.Provider>
  );
}
