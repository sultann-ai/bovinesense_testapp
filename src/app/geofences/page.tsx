"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Plus, ShieldAlert, CheckCircle, Pencil, Trash2, X,
  ChevronDown, Layers,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { buildMapStyle, PUNJAB_BOUNDS } from "@/lib/map-style";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FenceRow {
  id: number;
  name: string;
  type: "district" | "polygon" | "radius";
  warning_buffer_m: number;
  district_name: string | null;
  created_at: string;
  animal_count: number;
  breach_count: number;
}

interface CreateForm {
  name: string;
  type: "district" | "polygon" | "radius";
  warning_buffer_m: number;
  district_name: string;
  // polygon: GeoJSON from terra-draw
  drawnGeojson: Record<string, unknown> | null;
  // radius
  center_lat: string;
  center_lon: string;
  radius_m: string;
}

const BLANK_FORM: CreateForm = {
  name: "",
  type: "district",
  warning_buffer_m: 500,
  district_name: "",
  drawnGeojson: null,
  center_lat: "",
  center_lon: "",
  radius_m: "",
};

const FENCE_TYPE_LABELS: Record<string, string> = {
  district: "Administrative (district)",
  polygon:  "Custom polygon",
  radius:   "Radius circle",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Geofence map with terra-draw ─────────────────────────────────────────────
// This component is only loaded client-side (dynamic import with ssr:false below).

function GeofenceMapInner({
  fences,
  drawMode,
  onGeometryReady,
  onMapClick,
}: {
  fences: FenceRow[];
  drawMode: "idle" | "polygon" | "radius";
  onGeometryReady: (geojson: Record<string, unknown>) => void;
  onMapClick: (lat: number, lon: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const drawRef      = useRef<any>(null);
  const drawModeRef  = useRef(drawMode);
  drawModeRef.current = drawMode;
  const fencesRef    = useRef(fences);
  fencesRef.current  = fences;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: any;

    (async () => {
      const ml = await import("maplibre-gl");
      await import("maplibre-gl/dist/maplibre-gl.css");

      map = new ml.Map({
        container: containerRef.current!,
        style:     buildMapStyle(process.env.NEXT_PUBLIC_MAPTILER_KEY ?? ""),
        bounds:    PUNJAB_BOUNDS,
        fitBoundsOptions: { padding: 30 },
        attributionControl: false,
      });
      mapRef.current = map;
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", async () => {
        // District boundary layer
        try {
          const geojson = await fetch("/api/boundaries").then((r) => r.json());
          map.addSource("boundaries", { type: "geojson", data: geojson });
          map.addLayer({
            id: "boundaries-line", type: "line", source: "boundaries",
            paint: { "line-color": "#B9AE9C", "line-width": 1, "line-dasharray": [3, 3] },
          });
        } catch { /* no boundaries */ }

        // Existing geofences source
        map.addSource("fences", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "fences-fill", type: "fill", source: "fences",
          paint: { "fill-color": "var(--brand)", "fill-opacity": 0.08 },
        });
        map.addLayer({
          id: "fences-line", type: "line", source: "fences",
          paint: { "line-color": "var(--brand)", "line-width": 1.5 },
        });

        // Map click for radius center placement
        map.on("click", (e: any) => {
          if (drawModeRef.current === "radius") {
            onMapClick(e.lngLat.lat, e.lngLat.lng);
          }
        });

        updateFences(map, fencesRef.current);

        // Initialize terra-draw
        try {
          const { TerraDraw, TerraDrawPolygonMode } = await import("terra-draw");
          const { TerraDrawMapLibreGLAdapter } = await import("terra-draw-maplibre-gl-adapter");

          const draw = new TerraDraw({
            adapter: new TerraDrawMapLibreGLAdapter({ map }),
            modes: [new TerraDrawPolygonMode()],
          });
          draw.start();
          drawRef.current = draw;

          draw.on("change", (ids: (string | number)[], changeType: string) => {
            if (changeType === "create" && drawModeRef.current === "polygon") {
              const snapshot = draw.getSnapshot();
              const feature = snapshot.find((f: any) => ids.map(String).includes(String(f.id)));
              if (feature?.geometry) {
                onGeometryReady(feature.geometry as unknown as Record<string, unknown>);
                draw.setMode("static");
              }
            }
          });
        } catch (e) {
          console.warn("terra-draw unavailable:", e);
        }
      });
    })();

    return () => {
      drawRef.current?.stop();
      map?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync draw mode
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    try {
      if (drawMode === "polygon") {
        draw.clear();
        draw.setMode("polygon");
      } else {
        draw.setMode("static");
      }
    } catch { /* draw not ready */ }
  }, [drawMode]);

  // Sync fences on the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getSource("fences")) return;
    updateFences(map, fences);
  }, [fences]);

  return <div ref={containerRef} className="absolute inset-0" />;
}

function updateFences(map: any, fences: FenceRow[]) {
  // Without real geometry from the API, show a placeholder
  // When PostGIS is available, /api/geofences would return geojson
  const src = map.getSource("fences");
  if (src) src.setData({ type: "FeatureCollection", features: [] });
}

const GeofenceMap = dynamic(
  () => Promise.resolve(GeofenceMapInner),
  { ssr: false },
);

// ─── New fence dialog ─────────────────────────────────────────────────────────

function NewFenceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (fence: FenceRow) => void;
}) {
  const [form,    setForm]    = useState<CreateForm>(BLANK_FORM);
  const [drawing, setDrawing] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [districts, setDistricts] = useState<string[]>([]);

  // Fetch district names from boundaries
  useEffect(() => {
    if (!open) return;
    fetch("/api/boundaries")
      .then((r) => r.json())
      .then((fc) => {
        const names: string[] = fc?.features?.map((f: any) => f.properties?.district_name).filter(Boolean) ?? [];
        setDistricts([...new Set(names)].sort());
      })
      .catch(() => {});
  }, [open]);

  function set<K extends keyof CreateForm>(k: K, v: CreateForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleGeometryReady(geojson: Record<string, unknown>) {
    set("drawnGeojson", geojson);
    setDrawing(false);
  }

  async function submit() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (form.type === "district" && !form.district_name) { setError("Select a district."); return; }
    if (form.type === "polygon" && !form.drawnGeojson) { setError("Draw the polygon on the map."); return; }
    if (form.type === "radius" && (!form.center_lat || !form.center_lon || !form.radius_m)) {
      setError("Enter center coordinates and radius."); return;
    }

    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        name:             form.name.trim(),
        type:             form.type,
        warning_buffer_m: form.warning_buffer_m,
        district_name:    form.district_name || null,
        geojson:          form.drawnGeojson,
        center_lat:       form.center_lat ? parseFloat(form.center_lat) : undefined,
        center_lon:       form.center_lon ? parseFloat(form.center_lon) : undefined,
        radius_m:         form.radius_m   ? parseFloat(form.radius_m)   : undefined,
      };

      const res = await fetch("/api/geofences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Failed to create geofence.");
        return;
      }

      const fence = await res.json();
      onCreated({ ...fence, animal_count: 0, breach_count: 0 });
      onClose();
      setForm(BLANK_FORM);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const drawMode: "idle" | "polygon" | "radius" =
    drawing && form.type === "polygon" ? "polygon" :
    drawing && form.type === "radius"  ? "radius"  :
    "idle";

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border shadow-[var(--shadow-float)] overflow-hidden"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)", maxHeight: "90vh" }}
        >
          {/* Form panel */}
          <div className="w-[320px] shrink-0 flex flex-col border-r overflow-y-auto" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border)" }}>
              <Dialog.Title className="text-base font-semibold text-text-primary">New geofence</Dialog.Title>
              <button onClick={onClose} className="rounded p-1 text-text-secondary hover:bg-bg-sunken">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">
                  Fence name
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Lahore District"
                  className="w-full rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)", color: "var(--text-primary)" }}
                />
              </div>

              {/* Type */}
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">
                  Fence type
                </label>
                <div className="relative">
                  <select
                    value={form.type}
                    onChange={(e) => { set("type", e.target.value as CreateForm["type"]); set("drawnGeojson", null); setDrawing(false); }}
                    className="w-full appearance-none rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)", color: "var(--text-primary)" }}
                  >
                    <option value="district">Administrative (district)</option>
                    <option value="polygon">Custom polygon</option>
                    <option value="radius">Radius circle</option>
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                </div>
              </div>

              {/* District picker */}
              {form.type === "district" && (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">
                    District
                  </label>
                  <div className="relative">
                    <select
                      value={form.district_name}
                      onChange={(e) => set("district_name", e.target.value)}
                      className="w-full appearance-none rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none"
                      style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)", color: form.district_name ? "var(--text-primary)" : "var(--text-secondary)" }}
                    >
                      <option value="">Select district…</option>
                      {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  </div>
                </div>
              )}

              {/* Polygon drawing */}
              {form.type === "polygon" && (
                <div>
                  {form.drawnGeojson ? (
                    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2"
                      style={{ borderColor: "var(--status-inside)", backgroundColor: "var(--status-inside-tint)" }}>
                      <CheckCircle size={14} style={{ color: "var(--status-inside)" }} />
                      <span className="text-xs" style={{ color: "var(--status-inside)" }}>Polygon drawn</span>
                      <button
                        onClick={() => { set("drawnGeojson", null); }}
                        className="ml-auto text-xs"
                        style={{ color: "var(--status-inside)" }}
                      >
                        Redo
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDrawing(!drawing)}
                      className={cn(
                        "w-full rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-medium transition-colors",
                        drawing ? "ring-1" : "",
                      )}
                      style={{
                        borderColor: drawing ? "var(--brand)" : "var(--border)",
                        backgroundColor: drawing ? "var(--brand-tint)" : "var(--bg-surface)",
                        color: drawing ? "var(--brand)" : "var(--text-primary)",
                      }}
                    >
                      {drawing ? "Drawing… click to add points, double-click to close" : "Draw on map →"}
                    </button>
                  )}
                </div>
              )}

              {/* Radius inputs */}
              {form.type === "radius" && (
                <div className="space-y-3">
                  <p className="text-xs text-text-secondary">Click on the map to set centre, or enter coordinates:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-[0.04em] text-text-secondary">Latitude</label>
                      <input
                        type="number" value={form.center_lat}
                        onChange={(e) => set("center_lat", e.target.value)}
                        placeholder="31.52"
                        step="0.001"
                        className="w-full rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm outline-none font-mono-ids"
                        style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)", color: "var(--text-primary)" }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-[0.04em] text-text-secondary">Longitude</label>
                      <input
                        type="number" value={form.center_lon}
                        onChange={(e) => set("center_lon", e.target.value)}
                        placeholder="74.34"
                        step="0.001"
                        className="w-full rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm outline-none font-mono-ids"
                        style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)", color: "var(--text-primary)" }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-[0.04em] text-text-secondary">Radius (metres)</label>
                    <input
                      type="number" value={form.radius_m}
                      onChange={(e) => set("radius_m", e.target.value)}
                      placeholder="2000"
                      min="100" max="50000"
                      className="w-full rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm outline-none"
                      style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)", color: "var(--text-primary)" }}
                    />
                  </div>
                </div>
              )}

              {/* Warning buffer */}
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">
                  Warning buffer
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={form.warning_buffer_m}
                    onChange={(e) => set("warning_buffer_m", parseInt(e.target.value) || 500)}
                    min="50" max="5000" step="50"
                    className="w-24 rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none tabular-nums"
                    style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)", color: "var(--text-primary)" }}
                  />
                  <span className="text-sm text-text-secondary">metres</span>
                </div>
                <p className="mt-1 text-[11px] text-text-secondary">
                  Alerts &quot;Near boundary&quot; when the animal is within this distance inside the fence.
                </p>
              </div>

              {error && (
                <p className="text-xs" style={{ color: "var(--status-breach)" }}>{error}</p>
              )}
            </div>

            <div className="p-4 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={onClose}
                className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm text-text-secondary hover:bg-bg-sunken transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: "var(--brand)" }}
              >
                {busy ? "Creating…" : "Create fence"}
              </button>
            </div>
          </div>

          {/* Map panel */}
          <div className="relative flex-1 min-h-[420px]">
            <div className="absolute inset-0">
              <GeofenceMap
                fences={[]}
                drawMode={drawMode}
                onGeometryReady={handleGeometryReady}
                onMapClick={(lat, lon) => {
                  set("center_lat", lat.toFixed(6));
                  set("center_lon", lon.toFixed(6));
                }}
              />
            </div>
            {drawMode === "polygon" && (
              <div
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs font-medium shadow-[var(--shadow-float)]"
                style={{ backgroundColor: "var(--brand)", color: "#fff" }}
              >
                Click to add vertices · Double-click to close
              </div>
            )}
            {drawMode === "radius" && (
              <div
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-4 py-1.5 text-xs font-medium shadow-[var(--shadow-float)]"
                style={{ backgroundColor: "var(--brand)", color: "#fff" }}
              >
                Click on the map to place the centre
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Delete confirmation ──────────────────────────────────────────────────────

function DeleteDialog({
  fence,
  onClose,
  onDeleted,
}: {
  fence: FenceRow;
  onClose: () => void;
  onDeleted: (id: number) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    await fetch(`/api/geofences/${fence.id}`, { method: "DELETE" });
    onDeleted(fence.id);
    onClose();
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border p-6 shadow-[var(--shadow-float)]"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)" }}
        >
          <Dialog.Title className="text-base font-semibold text-text-primary mb-2">Delete geofence?</Dialog.Title>
          <p className="text-sm text-text-secondary mb-4">
            <strong>{fence.name}</strong> and all its animal assignments will be permanently removed. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm text-text-secondary hover:bg-bg-sunken transition-colors" style={{ borderColor: "var(--border)" }}>
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={busy}
              className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors"
              style={{ backgroundColor: "var(--status-breach)" }}
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GeofencesPage() {
  const [fences,      setFences]      = useState<FenceRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error503,    setError503]    = useState(false);
  const [newOpen,     setNewOpen]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FenceRow | null>(null);
  const [selectedId,  setSelectedId]  = useState<number | null>(null);

  const fetchFences = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetch("/api/geofences").then((r) => r.json());
      if (!Array.isArray(rows)) { setError503(true); return; }
      setFences(rows);
      setError503(false);
    } catch {
      setError503(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFences(); }, [fetchFences]);

  return (
    <div className="flex h-full flex-col -m-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Geofences</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Create and manage zones — district, polygon, or radius.
          </p>
        </div>
        <button
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: "var(--brand)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--brand-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--brand)")}
        >
          <Plus size={15} strokeWidth={1.5} />
          New geofence
        </button>
      </div>

      {/* Map + list layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="relative flex-1 border-r" style={{ borderColor: "var(--border)" }}>
          <GeofenceMap
            fences={fences}
            drawMode="idle"
            onGeometryReady={() => {}}
            onMapClick={() => {}}
          />

          {fences.length === 0 && !loading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="text-center px-6 py-4 rounded-[var(--radius-md)]"
                style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-float)" }}
              >
                <Layers size={28} strokeWidth={1.5} style={{ color: "var(--text-secondary)", margin: "0 auto 8px" }} />
                <p className="text-sm text-text-secondary">No geofences yet</p>
                <p className="text-xs text-text-secondary mt-1">Click &quot;New geofence&quot; to add the first zone</p>
              </div>
            </div>
          )}
        </div>

        {/* Fence list */}
        <div className="w-[360px] shrink-0 flex flex-col overflow-hidden">
          <div
            className="px-4 py-3 border-b text-[10px] font-semibold uppercase tracking-[0.04em] text-text-secondary"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)" }}
          >
            {loading ? "Loading…" : `${fences.length} fence${fences.length !== 1 ? "s" : ""}`}
          </div>

          <div className="flex-1 overflow-y-auto">
            {error503 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2">
                <p className="text-sm text-text-secondary">Database unavailable.</p>
                <button onClick={fetchFences} className="text-xs" style={{ color: "var(--brand-hover)" }}>Retry</button>
              </div>
            ) : loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border-b px-4 py-4 space-y-2" style={{ borderColor: "var(--border)" }}>
                  <div className="h-4 rounded animate-pulse" style={{ backgroundColor: "var(--bg-sunken)", width: "60%" }} />
                  <div className="h-3 rounded animate-pulse" style={{ backgroundColor: "var(--bg-sunken)", width: "40%" }} />
                </div>
              ))
            ) : fences.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-text-secondary">No geofences yet.</p>
              </div>
            ) : (
              fences.map((f) => (
                <div
                  key={f.id}
                  className="border-b px-4 py-4 cursor-pointer transition-colors"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: selectedId === f.id ? "var(--brand-tint)" : undefined,
                  }}
                  onClick={() => setSelectedId(selectedId === f.id ? null : f.id)}
                  onMouseEnter={(e) => { if (selectedId !== f.id) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-sunken)"; }}
                  onMouseLeave={(e) => { if (selectedId !== f.id) (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{f.name}</p>
                      <p className="text-xs text-text-secondary mt-0.5">{FENCE_TYPE_LABELS[f.type]}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(f); }}
                      className="shrink-0 rounded p-1 text-text-secondary hover:text-status-breach hover:bg-bg-sunken transition-colors"
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <span className="tabular-nums text-xs text-text-secondary">
                      {f.animal_count} animal{f.animal_count !== 1 ? "s" : ""}
                    </span>
                    {f.breach_count > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: "var(--status-breach-tint)", color: "var(--status-breach)" }}
                      >
                        <ShieldAlert size={10} />
                        {f.breach_count} breach{f.breach_count > 1 ? "es" : ""}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{ backgroundColor: "var(--status-inside-tint)", color: "var(--status-inside)" }}
                      >
                        <CheckCircle size={10} />
                        Clear
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-text-secondary">{f.warning_buffer_m}m buffer</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {newOpen && (
        <NewFenceDialog
          open={newOpen}
          onClose={() => setNewOpen(false)}
          onCreated={(fence) => { setFences((prev) => [fence, ...prev]); }}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          fence={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(id) => setFences((prev) => prev.filter((f) => f.id !== id))}
        />
      )}
    </div>
  );
}
