"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { KpiStrip, type KpiData } from "./KpiStrip";
import { FilterBar, type Filters } from "./FilterBar";
import { AlertFeed, type AlertRow } from "./AlertFeed";
import { OverviewMap, type MarkerFeature } from "./OverviewMap";
import { AnimalDrawer } from "./AnimalDrawer";
import { ToastStack, type ToastItem } from "./ToastStack";

type BovineEvent =
  | { kind: "fix";   animalId: number; tagId: number; branchId: number; regionId: number }
  | { kind: "alert"; alertId: number; alertType: string; severity: string; status: string; animalId: number; branchId: number; regionId: number };

export default function OverviewClient() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const [kpi,          setKpi]          = useState<KpiData | null>(null);
  const [kpiLoading,   setKpiLoading]   = useState(true);
  const [alerts,       setAlerts]       = useState<AlertRow[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [markers,      setMarkers]      = useState<MarkerFeature[]>([]);
  const [filters,      setFilters]      = useState<Filters>({ status: null, lastFix: null, type: null });
  const [selectedAnimal, setSelectedAnimal] = useState<number | null>(null);
  const [flyToAnimal,  setFlyToAnimal]  = useState<number | null>(null);
  const [toasts,       setToasts]       = useState<ToastItem[]>([]);

  // Handle ?animal= URL param (from search or Animals page "Locate")
  useEffect(() => {
    const animalParam = searchParams.get("animal");
    if (animalParam) {
      const id = parseInt(animalParam, 10);
      if (!isNaN(id)) {
        setSelectedAnimal(id);
        setFlyToAnimal(id);
        // Remove param from URL without navigation
        router.replace("/", { scroll: false });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data fetchers ──────────────────────────────────────────────────────────
  const fetchKpi = useCallback(async () => {
    try {
      const d = await fetch("/api/kpi").then((r) => r.json());
      setKpi(d);
    } catch { /* DB not ready */ }
    finally { setKpiLoading(false); }
  }, []);

  const fetchAlerts = useCallback(async (f: Filters) => {
    setAlertsLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.type)   params.set("type",   f.type);
      const d = await fetch(`/api/alerts/feed?${params}`).then((r) => r.json());
      setAlerts(Array.isArray(d) ? d : []);
    } catch { /* DB not ready */ }
    finally { setAlertsLoading(false); }
  }, []);

  const fetchMarkers = useCallback(async () => {
    try {
      const d = await fetch("/api/animals/markers").then((r) => r.json());
      setMarkers(d?.features ?? []);
    } catch { /* DB not ready */ }
  }, []);

  // Initial load
  useEffect(() => {
    fetchKpi();
    fetchAlerts(filters);
    fetchMarkers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when filters change
  useEffect(() => { fetchAlerts(filters); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SSE stream ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/events");

      es.onmessage = (e) => {
        try {
          const event: BovineEvent = JSON.parse(e.data);

          if (event.kind === "fix") {
            // Refresh markers to get new position and status
            fetchMarkers();
          }

          if (event.kind === "alert") {
            fetchAlerts(filters);
            fetchKpi();

            if (event.status === "new" && (event.severity === "critical" || event.severity === "warning")) {
              const alert = alerts.find((a) => a.animal_id === event.animalId);
              const toast: ToastItem = {
                id:        `${event.alertId}-${Date.now()}`,
                alertType: event.alertType,
                severity:  event.severity,
                title:     alert?.title ?? titleFromType(event.alertType),
                animalId:  event.animalId,
                detail:    alert?.detail ?? undefined,
              };
              setToasts((prev) => [toast, ...prev.slice(0, 4)]);
            }
          }
        } catch { /* parse error */ }
      };

      es.onerror = () => {
        es?.close();
        // Reconnect after 5 s
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Also poll every 30 s as fallback
  useEffect(() => {
    const t = setInterval(() => {
      fetchKpi();
      fetchAlerts(filters);
      fetchMarkers();
    }, 30_000);
    return () => clearInterval(t);
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Alert actions ──────────────────────────────────────────────────────────
  const handleAcknowledge = useCallback(async (alertId: number) => {
    try {
      await fetch(`/api/alerts/${alertId}/transition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_status: "acknowledged" }),
      });
      fetchAlerts(filters);
      fetchKpi();
    } catch (err) {
      console.error(err);
    }
  }, [filters, fetchAlerts, fetchKpi]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toast management ───────────────────────────────────────────────────────
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleToastView = useCallback((animalId: number) => {
    setSelectedAnimal(animalId);
    setFlyToAnimal(animalId);
  }, []);

  // ── Marker / alert interactions ────────────────────────────────────────────
  const handleMarkerClick  = useCallback((id: number) => setSelectedAnimal(id), []);
  const handleAlertSelect  = useCallback((id: number) => setSelectedAnimal(id), []);
  const handleFlyTo        = useCallback((id: number) => { setFlyToAnimal(id); }, []);
  const handleFlyComplete  = useCallback(() => setFlyToAnimal(null), []);

  const openAlertCount = alerts.filter((a) => a.status === "new").length;

  return (
    <div className="flex h-full flex-col overflow-hidden -m-6">
      {/* KPI strip */}
      <KpiStrip data={kpi} loading={kpiLoading} />

      {/* Filter chips */}
      <FilterBar filters={filters} onChange={setFilters} />

      {/* Map + alert panel */}
      <div className="relative flex flex-1 overflow-hidden">
        <OverviewMap
          markers={markers}
          selectedAnimalId={selectedAnimal}
          onMarkerClick={handleMarkerClick}
          flyToAnimalId={flyToAnimal}
          onFlyToComplete={handleFlyComplete}
        />

        {/* Alert feed */}
        <AlertFeed
          alerts={alerts}
          loading={alertsLoading}
          total={openAlertCount}
          selectedId={selectedAnimal}
          onSelectAnimal={handleAlertSelect}
          onAcknowledge={handleAcknowledge}
          onFlyTo={handleFlyTo}
        />

        {/* Animal drawer (slides over alert feed) */}
        <AnimalDrawer
          animalId={selectedAnimal}
          onClose={() => setSelectedAnimal(null)}
          onFlyTo={handleFlyTo}
        />
      </div>

      {/* Toast stack */}
      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        onView={handleToastView}
      />
    </div>
  );
}

function titleFromType(type: string): string {
  const map: Record<string, string> = {
    breach:        "Left district boundary",
    near_boundary: "Near district boundary",
    fast_movement: "Fast movement detected",
    tag_offline:   "Tag offline",
    low_battery:   "Low battery",
    returned:      "Returned to boundary",
  };
  return map[type] ?? type;
}
