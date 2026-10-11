"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { KpiStrip } from "./KpiStrip";
import { FilterBar, type Filters } from "./FilterBar";
import { AlertFeed, type AlertRow } from "./AlertFeed";
import { OverviewMap, type MarkerFeature } from "./OverviewMap";
import { AnimalDrawer } from "./AnimalDrawer";
import { AssignDialog, ResolveDialog } from "@/components/alerts/AlertDialogs";
import { ErrorState } from "@/components/ui/states";
import { useScope } from "@/components/shell/ScopeProvider";
import { useLive, useLiveEvents, useResync } from "@/components/realtime/RealtimeProvider";
import type { LiveEvent, LiveFix } from "@/lib/realtime/events";
import { applyLiveToMarkers } from "@/lib/realtime/markers";
import { DEFAULT_TRAIL_HOURS, type TrailHours } from "@/lib/maps/trail";
import { hoursSince } from "@/lib/format";

/** Position updates are applied in one batch this often, so a busy fleet is one redraw, not hundreds. */
const MARKER_FLUSH_MS = 400;
/** Alert changes refetch the feed (and marker flags) once things settle for this long. */
const REFETCH_DEBOUNCE_MS = 700;

/** Which "last fix" window a chip stands for, in hours: [from, to). */
const LAST_FIX_WINDOWS: Record<string, [number, number]> = { "1h": [0, 1], "6h": [1, 6], "24h": [6, 24] };

export function filterMarkers(markers: readonly MarkerFeature[], filters: Filters, now: number = Date.now()): MarkerFeature[] {
  const window = filters.lastFix ? LAST_FIX_WINDOWS[filters.lastFix] : undefined;
  return markers.filter((m) => {
    if (filters.status && m.properties.status !== filters.status) return false;
    if (window) {
      const age = hoursSince(m.properties.fixed_at, now);
      if (age === null || age < window[0] || age >= window[1]) return false;
    }
    return true;
  });
}

/** Which alert type belongs to which animal status, so a status filter narrows the feed too. */
const ALERT_TYPE_OF_STATUS: Record<string, string> = {
  breach: "breach", near: "near_boundary", fast: "fast_movement", stale: "tag_offline",
};

export function filterAlerts<T extends { type: string; status: string }>(alerts: readonly T[], status: string | null, unackOnly: boolean): T[] {
  const type = status ? ALERT_TYPE_OF_STATUS[status] : undefined;
  return alerts.filter((a) => (!status || status === "inside" || a.type === type) && (!unackOnly || a.status === "new"));
}

export default function OverviewClient() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const scope        = useScope();
  const { kpi, kpiLoading, refreshKpi } = useLive();
  const [alerts,       setAlerts]       = useState<AlertRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsFailed, setAlertsFailed] = useState(false);
  const [markers,      setMarkers]      = useState<MarkerFeature[]>([]);
  const [markersFailed, setMarkersFailed] = useState(false);
  const [filters,      setFilters]      = useState<Filters>({ status: null, lastFix: null, type: null });
  const [unackOnly,    setUnackOnly]    = useState(false);
  // A clicked pin is "selected" (gold ring + popup); its details drawer opens on request.
  const [selectedAnimal, setSelectedAnimal] = useState<number | null>(null);
  const [drawerAnimal, setDrawerAnimal] = useState<number | null>(null);
  const [flyToAnimal,  setFlyToAnimal]  = useState<number | null>(null);
  // The trail shown on the map. It belongs to one animal: when another is opened it is gone.
  const [trail, setTrail] = useState<{ animalId: number; hours: TrailHours } | null>(null);
  const activeTrail = trail !== null && trail.animalId === drawerAnimal ? trail : null;

  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; });
  const markersRef = useRef(markers);
  useEffect(() => { markersRef.current = markers; });
  const scopeRef = useRef(scope);
  useEffect(() => { scopeRef.current = scope; });

  // Handle ?animal= URL param (from search, the Animals page "Locate", or a toast's "View"):
  // select the animal, fly to it and open its details.
  // (State is adjusted while rendering, the way React recommends for state derived from props.)
  const animalParam = searchParams.get("animal");
  const [handledParam, setHandledParam] = useState<string | null>(null);
  if (animalParam !== handledParam) {
    setHandledParam(animalParam);
    const id = animalParam ? parseInt(animalParam, 10) : NaN;
    if (!isNaN(id)) {
      setSelectedAnimal(id);
      setDrawerAnimal(id);
      setFlyToAnimal(id);
    }
  }
  useEffect(() => {
    if (animalParam) router.replace("/", { scroll: false }); // remove the param without navigating
  }, [animalParam, router]);

  // ── Data fetchers ──────────────────────────────────────────────────────────
  const fetchAlerts = useCallback(async (f: Filters) => {
    try {
      const params = new URLSearchParams();
      if (f.type) params.set("type", f.type);
      const res = await fetch(scopeRef.current.scoped(`/api/alerts/feed?${params}`), { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setAlerts(Array.isArray(d) ? d : []);
      setAlertsFailed(false);
    } catch {
      setAlertsFailed(true);
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  const fetchMarkers = useCallback(async () => {
    try {
      const res = await fetch(scopeRef.current.scoped("/api/animals/markers"), { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setMarkers(d?.features ?? []);
      setMarkersFailed(false);
    } catch {
      setMarkersFailed(true);
    }
  }, []);

  // Load, and load again when the alert type or the scope (region / branch) changes.
  const scopeKey = scope.key;
  useEffect(() => {
    void fetchAlerts(filters);
  }, [filters.type, scopeKey, fetchAlerts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void fetchMarkers();
  }, [scopeKey, fetchMarkers]);

  const retryAll = useCallback(() => {
    setAlertsLoading(true);
    void fetchAlerts(filtersRef.current);
    void fetchMarkers();
    refreshKpi();
  }, [fetchAlerts, fetchMarkers, refreshKpi]);

  // After the live connection (re)synchronises, anything may have changed while it was down.
  useResync(() => {
    void fetchAlerts(filtersRef.current);
    void fetchMarkers();
  });

  // ── Live updates ───────────────────────────────────────────────────────────
  const pendingFixes    = useRef(new Map<number, LiveFix>());
  const pendingStatus   = useRef(new Map<number, string>());
  const flushTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushMarkers = useCallback(() => {
    flushTimer.current = null;
    const fixes = pendingFixes.current;
    const statuses = pendingStatus.current;
    pendingFixes.current = new Map();
    pendingStatus.current = new Map();
    setMarkers((prev) => applyLiveToMarkers(prev, fixes, statuses));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!flushTimer.current) flushTimer.current = setTimeout(flushMarkers, MARKER_FLUSH_MS);
  }, [flushMarkers]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void fetchAlerts(filtersRef.current);
      void fetchMarkers();
    }, REFETCH_DEBOUNCE_MS);
  }, [fetchAlerts, fetchMarkers]);

  useEffect(() => () => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
  }, []);

  useLiveEvents((event: LiveEvent) => {
    switch (event.kind) {
      case "fix":
        // A new position moves the marker. An animal we do not show (another scope, or new) is
        // looked up with a refetch, which applies the scope.
        if (markersRef.current.some((m) => m.properties.id === event.fix.animalId)) {
          pendingFixes.current.set(event.fix.animalId, event.fix);
          scheduleFlush();
        } else {
          scheduleRefetch();
        }
        break;
      case "animal":
        pendingStatus.current.set(event.animal.id, event.animal.status);
        scheduleFlush();
        break;
      case "alert":
        // New, acknowledged, assigned or resolved (by anyone): feed and marker flags change.
        scheduleRefetch();
        break;
    }
  });

  // ── Alert actions ──────────────────────────────────────────────────────────
  const handleAcknowledge = useCallback(async (alertId: number) => {
    try {
      const res = await fetch(`/api/alerts/${alertId}/transition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_status: "acknowledged" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      void fetchAlerts(filtersRef.current); // the live update confirms it for everyone else
      refreshKpi();
    } catch (err) {
      console.error(err);
      setAlertsFailed(true);
    }
  }, [fetchAlerts, refreshKpi]);

  // Assign / Resolve open a dialog; once the server accepted the change the feed and KPIs reload.
  const [alertDialog, setAlertDialog] = useState<{ kind: "assign" | "resolve"; alertId: number } | null>(null);
  const handleAssign = useCallback((alertId: number) => setAlertDialog({ kind: "assign", alertId }), []);
  const handleResolve = useCallback((alertId: number) => setAlertDialog({ kind: "resolve", alertId }), []);
  const handleDialogDone = useCallback(() => {
    void fetchAlerts(filtersRef.current);
    void fetchMarkers();
    refreshKpi();
  }, [fetchAlerts, fetchMarkers, refreshKpi]);

  // ── Marker / alert interactions ────────────────────────────────────────────
  const handleOpenDetails = useCallback((id: number) => { setSelectedAnimal(id); setDrawerAnimal(id); }, []);
  // A pin, an alert card's "View on map" and a table row all lead to the same place: the details drawer.
  const handleMarkerClick = handleOpenDetails;
  const handleViewOnMap    = useCallback((id: number) => { setSelectedAnimal(id); setDrawerAnimal(id); setFlyToAnimal(id); }, []);
  const handleFlyTo       = useCallback((id: number) => { setFlyToAnimal(id); }, []);
  const handleFlyComplete = useCallback(() => setFlyToAnimal(null), []);
  const handleCloseDrawer = useCallback(() => setDrawerAnimal(null), []);
  const handleClosePopup  = useCallback(() => setSelectedAnimal(null), []);
  const handleToggleTrail = useCallback(
    (id: number) => setTrail((t) => (t && t.animalId === id ? null : { animalId: id, hours: DEFAULT_TRAIL_HOURS })),
    [],
  );
  const handleTrailHours  = useCallback((hours: TrailHours) => setTrail((t) => (t ? { ...t, hours } : t)), []);
  const handleTrailClose  = useCallback(() => setTrail(null), []);

  const shownAlerts = useMemo(() => filterAlerts(alerts, filters.status, unackOnly), [alerts, filters.status, unackOnly]);
  const shownMarkers = useMemo(() => filterMarkers(markers, filters), [markers, filters]);
  const kpiFailed = !kpiLoading && kpi === null;

  // -m-6 cancels the page padding, so the height adds it back: no empty band under the map.
  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] flex-col overflow-hidden">
      <KpiStrip
        data={kpi}
        loading={kpiLoading}
        onRetry={kpiFailed ? retryAll : undefined}
        activeStatus={filters.status}
        onSelectStatus={(status) => setFilters((f) => ({ ...f, status }))}
      />

      <FilterBar filters={filters} onChange={setFilters} />

      {markersFailed && <ErrorState compact what="The animals could not be loaded, so the map may be out of date." onRetry={retryAll} className="border-b border-border bg-bg-surface" />}

      <div className="relative flex flex-1 overflow-hidden">
        <OverviewMap
          markers={shownMarkers}
          selectedAnimalId={selectedAnimal}
          onMarkerClick={handleMarkerClick}
          flyToAnimalId={flyToAnimal}
          onFlyToComplete={handleFlyComplete}
          trailAnimalId={activeTrail?.animalId ?? null}
          trailHours={activeTrail?.hours ?? DEFAULT_TRAIL_HOURS}
          onTrailHoursChange={handleTrailHours}
          onTrailClose={handleTrailClose}
          popupAnimalId={drawerAnimal === null ? selectedAnimal : null}
          onOpenDetails={handleOpenDetails}
          onClosePopup={handleClosePopup}
        />

        <AlertFeed
          alerts={shownAlerts}
          loading={alertsLoading}
          failed={alertsFailed}
          onRetry={retryAll}
          total={shownAlerts.length}
          unackOnly={unackOnly}
          onUnackOnlyChange={setUnackOnly}
          selectedId={selectedAnimal}
          onSelectAnimal={handleOpenDetails}
          onAcknowledge={handleAcknowledge}
          onFlyTo={handleViewOnMap}
          onAssign={handleAssign}
          onResolve={handleResolve}
        />

        {/* Animal drawer (slides over the alert feed) */}
        <AnimalDrawer
          animalId={drawerAnimal}
          onClose={handleCloseDrawer}
          onFlyTo={handleFlyTo}
          onToggleTrail={handleToggleTrail}
          trailActive={activeTrail !== null}
        />
      </div>
      {alertDialog?.kind === "assign" && (
        <AssignDialog alertId={alertDialog.alertId} open onClose={() => setAlertDialog(null)} onDone={handleDialogDone} />
      )}
      {alertDialog?.kind === "resolve" && (
        <ResolveDialog alertId={alertDialog.alertId} open onClose={() => setAlertDialog(null)} onDone={handleDialogDone} />
      )}
    </div>
  );
}
