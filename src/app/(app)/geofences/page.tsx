"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus, CheckCircle, Pencil, Trash2, Users, X,
  ChevronDown, Layers,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { usePermissions } from "@/components/shell/PermissionsProvider";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/status-pill";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { AssignAnimalsDialog } from "@/components/geofences/AssignAnimalsDialog";
import { GeofenceMapView } from "@/components/map/GeofenceMapView";
import type { FenceFeature } from "@/components/map/types";
import {
  MAX_BUFFER_M, MAX_RADIUS_M, MIN_BUFFER_M, MIN_RADIUS_M,
  drawnFromSaved, payloadFromDrawn, payloadFromRadius, reshapeFields,
  type DrawnFeature, type ShapePayload,
} from "@/lib/maps/fences";
import { circleRing } from "@/lib/maps/geo";

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
  center_lat: string;
  center_lon: string;
  radius_m: string;
}

const BLANK_FORM: CreateForm = {
  name: "",
  type: "district",
  warning_buffer_m: 500,
  district_name: "",
  center_lat: "",
  center_lon: "",
  radius_m: "",
};

const FENCE_TYPE_LABELS: Record<string, string> = {
  district: "Administrative (district)",
  polygon:  "Custom polygon",
  radius:   "Radius circle",
};

const INPUT_STYLE = { borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)", color: "var(--text-primary)" } as const;

/** What the API answered, in words a person can act on. */
async function failureMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : fallback;
}

// ─── New fence dialog ─────────────────────────────────────────────────────────

function NewFenceDialog({
  open,
  fences,
  onClose,
  onCreated,
}: {
  open: boolean;
  fences: FenceFeature[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form,    setForm]    = useState<CreateForm>(BLANK_FORM);
  const [drawing, setDrawing] = useState(false);
  const [polygon, setPolygon] = useState<ShapePayload | null>(null);
  const [typed,   setTyped]   = useState(false); // the radius numbers were typed (not drawn)
  const [redo,    setRedo]    = useState(0);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [districts, setDistricts] = useState<string[]>([]);

  // District names for the district picker.
  useEffect(() => {
    if (!open) return;
    fetch("/api/boundaries")
      .then((r) => r.json())
      .then((fc) => {
        const names: string[] = fc?.features?.map((f: { properties?: { district_name?: string } }) => f.properties?.district_name).filter(Boolean) ?? [];
        setDistricts([...new Set(names)].sort());
      })
      .catch(() => {});
  }, [open]);

  function set<K extends keyof CreateForm>(k: K, v: CreateForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function changeType(type: CreateForm["type"]) {
    set("type", type);
    setDrawing(false);
    setPolygon(null);
    setTyped(false);
  }

  /** A shape was drawn, or adjusted after drawing. */
  function shapeFromMap(feature: DrawnFeature) {
    const r = payloadFromDrawn(feature);
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    if (r.value.type === "polygon") {
      setPolygon(r.value);
    } else {
      setTyped(false);
      setForm((f) => ({
        ...f,
        center_lat: r.value.type === "radius" ? String(r.value.center_lat) : f.center_lat,
        center_lon: r.value.type === "radius" ? String(r.value.center_lon) : f.center_lon,
        radius_m: r.value.type === "radius" ? String(r.value.radius_m) : f.radius_m,
      }));
    }
  }

  function startOver() {
    setPolygon(null);
    setTyped(false);
    setForm((f) => ({ ...f, center_lat: "", center_lon: "", radius_m: "" }));
    setRedo((n) => n + 1);
    setDrawing(true);
  }

  const radiusShape = payloadFromRadius(parseFloat(form.center_lat), parseFloat(form.center_lon), parseFloat(form.radius_m));

  async function submit() {
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (form.warning_buffer_m < MIN_BUFFER_M || form.warning_buffer_m > MAX_BUFFER_M) {
      setError(`The warning buffer must be between ${MIN_BUFFER_M} m and ${MAX_BUFFER_M} m.`); return;
    }

    const body: Record<string, unknown> = { name: form.name.trim(), type: form.type, warning_buffer_m: form.warning_buffer_m };
    if (form.type === "district") {
      if (!form.district_name) { setError("Select a district."); return; }
      body.district_name = form.district_name;
    } else if (form.type === "polygon") {
      if (!polygon || polygon.type !== "polygon") { setError("Draw the polygon on the map."); return; }
      body.geojson = polygon.geojson;
    } else {
      if (!radiusShape.ok) { setError(radiusShape.error); return; }
      const v = radiusShape.value;
      if (v.type !== "radius") return;
      body.center_lat = v.center_lat;
      body.center_lon = v.center_lon;
      body.radius_m = v.radius_m;
    }

    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/geofences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { setError(await failureMessage(res, "Failed to create geofence.")); return; }
      onCreated();
      onClose();
      setForm(BLANK_FORM);
      setDrawing(false);
      setPolygon(null);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  // What the map should be doing.
  const drawn = form.type === "polygon" ? polygon !== null : radiusShape.ok;
  const drawMode =
    form.type === "polygon" && drawing ? "polygon" :
    form.type === "radius" && typed && radiusShape.ok ? "preview" :
    form.type === "radius" && drawing ? "circle" :
    "off";
  const previewFeature =
    drawMode === "preview" && radiusShape.ok && radiusShape.value.type === "radius"
      ? { type: "Feature" as const, geometry: { type: "Polygon", coordinates: [circleRing([radiusShape.value.center_lon, radiusShape.value.center_lat], radiusShape.value.radius_m)] }, properties: { mode: "circle", radiusKilometers: radiusShape.value.radius_m / 1000 } }
      : null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border shadow-[var(--shadow-float)] overflow-hidden"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)", maxHeight: "90vh" }}
        >
          {/* Form panel */}
          <div className="w-[320px] shrink-0 flex flex-col border-r overflow-y-auto" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--border)" }}>
              <Dialog.Title className="text-base font-semibold text-text-primary">New geofence</Dialog.Title>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X size={16} /></Button>
            </div>

            <div className="flex-1 p-4 space-y-4">
              <div>
                <label htmlFor="fence-name" className="mb-1 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">Fence name</label>
                <input
                  id="fence-name" type="text" value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. North district"
                  className="w-full rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none"
                  style={INPUT_STYLE}
                />
              </div>

              <div>
                <label htmlFor="fence-type" className="mb-1 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">Fence type</label>
                <div className="relative">
                  <select
                    id="fence-type" value={form.type}
                    onChange={(e) => changeType(e.target.value as CreateForm["type"])}
                    className="w-full appearance-none rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none"
                    style={INPUT_STYLE}
                  >
                    <option value="district">Administrative (district)</option>
                    <option value="polygon">Custom polygon</option>
                    <option value="radius">Radius circle</option>
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                </div>
              </div>

              {form.type === "district" && (
                <div>
                  <label htmlFor="fence-district" className="mb-1 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">District</label>
                  <div className="relative">
                    <select
                      id="fence-district" value={form.district_name}
                      onChange={(e) => set("district_name", e.target.value)}
                      className="w-full appearance-none rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none"
                      style={{ ...INPUT_STYLE, color: form.district_name ? "var(--text-primary)" : "var(--text-secondary)" }}
                    >
                      <option value="">Select district…</option>
                      {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                  </div>
                </div>
              )}

              {form.type === "polygon" && (
                <div>
                  {polygon ? (
                    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2"
                      style={{ borderColor: "var(--status-inside)", backgroundColor: "var(--status-inside-tint)" }}>
                      <CheckCircle size={14} style={{ color: "var(--status-inside)" }} />
                      <span className="text-xs" style={{ color: "var(--status-inside)" }}>Polygon drawn. Drag a corner to adjust it.</span>
                      <Button variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={startOver}>Redo</Button>
                    </div>
                  ) : (
                    <Button
                      variant={drawing ? "primary" : "secondary"}
                      className="w-full"
                      onClick={() => setDrawing(!drawing)}
                      data-testid="draw-polygon"
                    >
                      {drawing ? "Drawing… click to add corners, double-click to close" : "Draw on map →"}
                    </Button>
                  )}
                </div>
              )}

              {form.type === "radius" && (
                <div className="space-y-3">
                  <Button
                    variant={drawing ? "primary" : "secondary"}
                    className="w-full"
                    onClick={() => (drawing || drawn ? startOver() : setDrawing(true))}
                    data-testid="draw-circle"
                  >
                    {drawing ? "Click the centre, move, click to set the radius" : drawn ? "Draw again" : "Draw on map →"}
                  </Button>
                  <p className="text-xs text-text-secondary">Or enter the centre and radius:</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="fence-lat" className="mb-1 block text-[10px] uppercase tracking-[0.04em] text-text-secondary">Latitude</label>
                      <input
                        id="fence-lat" type="number" value={form.center_lat}
                        onChange={(e) => { setTyped(true); setDrawing(false); set("center_lat", e.target.value); }}
                        placeholder="31.52" step="0.001"
                        className="w-full rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm outline-none font-mono-ids"
                        style={INPUT_STYLE}
                      />
                    </div>
                    <div>
                      <label htmlFor="fence-lon" className="mb-1 block text-[10px] uppercase tracking-[0.04em] text-text-secondary">Longitude</label>
                      <input
                        id="fence-lon" type="number" value={form.center_lon}
                        onChange={(e) => { setTyped(true); setDrawing(false); set("center_lon", e.target.value); }}
                        placeholder="74.34" step="0.001"
                        className="w-full rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm outline-none font-mono-ids"
                        style={INPUT_STYLE}
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="fence-radius" className="mb-1 block text-[10px] uppercase tracking-[0.04em] text-text-secondary">Radius (metres)</label>
                    <input
                      id="fence-radius" type="number" value={form.radius_m}
                      onChange={(e) => { setTyped(true); setDrawing(false); set("radius_m", e.target.value); }}
                      placeholder="2000" min={MIN_RADIUS_M} max={MAX_RADIUS_M}
                      className="w-full rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm outline-none"
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="fence-buffer" className="mb-1 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">Warning buffer</label>
                <div className="flex items-center gap-2">
                  <input
                    id="fence-buffer" type="number" value={form.warning_buffer_m}
                    onChange={(e) => set("warning_buffer_m", parseInt(e.target.value) || 500)}
                    min={MIN_BUFFER_M} max={MAX_BUFFER_M} step="50"
                    className="w-24 rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none tabular-nums"
                    style={INPUT_STYLE}
                  />
                  <span className="text-sm text-text-secondary">metres</span>
                </div>
                <p className="mt-1 text-[11px] text-text-secondary">
                  Alerts &quot;Near boundary&quot; when the animal is within this distance inside the fence.
                </p>
              </div>

              {error && <p role="alert" className="text-xs" style={{ color: "var(--status-breach)" }}>{error}</p>}
            </div>

            <div className="p-4 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={submit} busy={busy} data-testid="create-fence">
                {busy ? "Creating…" : "Create fence"}
              </Button>
            </div>
          </div>

          {/* Map panel */}
          <div className="relative flex-1 min-h-[460px]">
            <GeofenceMapView
              fences={fences}
              drawMode={drawMode}
              drawFeature={previewFeature}
              resetKey={redo}
              onDrawn={shapeFromMap}
              onEdited={shapeFromMap}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Delete confirmation ──────────────────────────────────────────────────────

function DeleteDialog({ fence, onClose, onDeleted }: { fence: FenceRow; onClose: () => void; onDeleted: (id: number) => void }) {
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
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" busy={busy} onClick={confirm}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Editing an existing fence ────────────────────────────────────────────────

interface Editing {
  id: number;
  type: FenceRow["type"];
  name: string;
  buffer: number;
  /** The shape loaded into the editor (null for a district fence: nothing to reshape). */
  feature: ReturnType<typeof drawnFromSaved>;
  /** The reshaped geometry, once the person has changed it. */
  shape: ShapePayload | null;
}

function EditBar({
  editing, busy, error, onChange, onSave, onCancel,
}: {
  editing: Editing; busy: boolean; error: string | null;
  onChange: (patch: Partial<Editing>) => void; onSave: () => void; onCancel: () => void;
}) {
  const reshapeable = editing.feature !== null;
  return (
    <div
      role="region" aria-label="Edit geofence" data-testid="edit-bar"
      className="absolute bottom-4 left-1/2 z-20 w-[min(560px,calc(100%-24px))] -translate-x-1/2 rounded-[var(--radius-md)] border p-3"
      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-float)" }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[160px] flex-1">
          <label htmlFor="edit-name" className="mb-1 block text-[10px] font-medium uppercase tracking-[0.04em] text-text-secondary">Name</label>
          <input
            id="edit-name" value={editing.name} onChange={(e) => onChange({ name: e.target.value })}
            className="w-full rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm outline-none" style={INPUT_STYLE}
          />
        </div>
        <div>
          <label htmlFor="edit-buffer" className="mb-1 block text-[10px] font-medium uppercase tracking-[0.04em] text-text-secondary">Buffer (m)</label>
          <input
            id="edit-buffer" type="number" min={MIN_BUFFER_M} max={MAX_BUFFER_M} step={50} value={editing.buffer}
            onChange={(e) => onChange({ buffer: parseInt(e.target.value) || 500 })}
            className="w-20 rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm tabular-nums outline-none" style={INPUT_STYLE}
          />
        </div>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={onSave} busy={busy} data-testid="save-fence">
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-text-secondary">
        {reshapeable
          ? editing.type === "radius"
            ? "Drag the circle to move it, or drag its edge to resize it."
            : "Drag a corner to move it, a midpoint to add one, or the shape to move it."
          : "A district fence follows its district boundary: only its name and buffer can change."}
      </p>
      {error && <p role="alert" className="mt-1 text-xs" style={{ color: "var(--status-breach)" }}>{error}</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GeofencesPage() {
  const { can } = usePermissions();
  const canManage = can("geofences:manage");
  const [fences,      setFences]      = useState<FenceRow[]>([]);
  const [features,    setFeatures]    = useState<FenceFeature[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error503,    setError503]    = useState(false);
  const [newOpen,     setNewOpen]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FenceRow | null>(null);
  const [assignTarget, setAssignTarget] = useState<FenceRow | null>(null);
  const [selectedId,  setSelectedId]  = useState<number | null>(null);
  const [editing,     setEditing]     = useState<Editing | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [editError,   setEditError]   = useState<string | null>(null);

  /** Asks for the fences; `null` means it failed. Sets no state, so effects can call it. */
  const loadFences = useCallback(async (): Promise<{ rows: FenceRow[]; features: FenceFeature[] } | null> => {
    try {
      const [rows, fc] = await Promise.all([
        fetch("/api/geofences", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/geofences/features", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!Array.isArray(rows)) return null;
      return { rows, features: Array.isArray(fc?.features) ? (fc.features as FenceFeature[]) : [] };
    } catch {
      return null;
    }
  }, []);

  const applyFences = useCallback((result: { rows: FenceRow[]; features: FenceFeature[] } | null) => {
    if (result) {
      setFences(result.rows);
      setFeatures(result.features);
    }
    setError503(result === null);
    setLoading(false);
  }, []);

  /** Reload after a change (no loading state: the list is updated in place). */
  const fetchFences = useCallback(async () => applyFences(await loadFences()), [loadFences, applyFences]);

  // The first load starts in the loading state; Try again shows it again.
  useEffect(() => {
    let cancelled = false;
    void loadFences().then((r) => { if (!cancelled) applyFences(r); });
    return () => { cancelled = true; };
  }, [loadFences, applyFences]);
  const retryFences = () => { setLoading(true); void fetchFences(); };

  function startEdit(f: FenceRow) {
    const saved = features.find((x) => x.id === f.id);
    setSelectedId(f.id);
    setEditError(null);
    setEditing({
      id: f.id, type: f.type, name: f.name, buffer: f.warning_buffer_m,
      feature: saved
        ? drawnFromSaved({
            type: f.type, geometry: saved.geometry,
            center_lat: saved.properties.center_lat, center_lon: saved.properties.center_lon, radius_m: saved.properties.radius_m,
          })
        : null,
      shape: null,
    });
  }

  function reshaped(feature: DrawnFeature) {
    const r = payloadFromDrawn(feature);
    if (!r.ok) { setEditError(r.error); return; }
    setEditError(null);
    setEditing((e) => (e ? { ...e, shape: r.value } : e));
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.name.trim()) { setEditError("A fence needs a name."); return; }
    const body: Record<string, unknown> = { name: editing.name.trim(), warning_buffer_m: editing.buffer };
    if (editing.shape) {
      const fields = reshapeFields(editing.type, editing.shape);
      if (!fields.ok) { setEditError(fields.error); return; }
      Object.assign(body, fields.value);
    }
    setSaving(true); setEditError(null);
    try {
      const res = await fetch(`/api/geofences/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { setEditError(await failureMessage(res, "The change could not be saved.")); return; }
      setEditing(null);
      await fetchFences();
    } catch {
      setEditError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col -m-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Geofences</h1>
          <p className="mt-1 text-sm text-text-secondary">Create and manage zones: district, polygon, or radius.</p>
        </div>
        <Button
          onClick={() => setNewOpen(true)}
          disabled={!canManage}
          title={canManage ? undefined : "Only organization admins can create geofences"}
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          New geofence
        </Button>
      </div>

      {/* Map + list layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="relative flex-1 border-r" style={{ borderColor: "var(--border)" }}>
          <GeofenceMapView
            fences={features}
            selectedId={selectedId}
            hiddenId={editing?.id ?? null}
            fitFenceId={selectedId}
            onSelectFence={(id) => { if (!editing) setSelectedId(id); }}
            drawMode={editing && editing.feature ? "edit" : "off"}
            drawFeature={editing?.feature ?? null}
            onEdited={reshaped}
          />

          {editing && (
            <EditBar
              editing={editing} busy={saving} error={editError}
              onChange={(patch) => setEditing((e) => (e ? { ...e, ...patch } : e))}
              onSave={saveEdit} onCancel={() => { setEditing(null); setEditError(null); }}
            />
          )}

          {fences.length === 0 && !loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-[var(--radius-md)] border border-border bg-bg-surface shadow-[var(--shadow-float)]">
                <EmptyState
                  icon={<Layers size={20} strokeWidth={1.5} />}
                  title={canManage ? "No geofences yet. Add the first zone." : "No geofences yet. An organization admin can add zones."}
                  action={canManage ? { label: "New geofence", onClick: () => setNewOpen(true) } : undefined}
                />
              </div>
            </div>
          )}
        </div>

        {/* Fence list */}
        <div className="w-[360px] shrink-0 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b text-[10px] font-semibold uppercase tracking-[0.04em] text-text-secondary" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)" }}>
            {loading ? "Loading…" : `${fences.length} fence${fences.length !== 1 ? "s" : ""}`}
          </div>

          <div className="flex-1 overflow-y-auto">
            {error503 ? (
              <ErrorState what="The geofences could not be loaded." onRetry={retryFences} />
            ) : loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} role="status" aria-label="Loading geofences" className="space-y-2 border-b border-border px-4 py-4">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              ))
            ) : fences.length === 0 ? (
              <EmptyState
                title="No geofences yet."
                action={canManage ? { label: "New geofence", onClick: () => setNewOpen(true) } : undefined}
              />
            ) : (
              fences.map((f) => (
                <div
                  key={f.id}
                  data-testid="fence-row"
                  className="border-b px-4 py-4 cursor-pointer transition-colors"
                  style={{ borderColor: "var(--border)", backgroundColor: selectedId === f.id ? "var(--brand-tint)" : undefined }}
                  onClick={() => { if (!editing) setSelectedId(selectedId === f.id ? null : f.id); }}
                  onMouseEnter={(e) => { if (selectedId !== f.id) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-sunken)"; }}
                  onMouseLeave={(e) => { if (selectedId !== f.id) (e.currentTarget as HTMLElement).style.backgroundColor = ""; }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{f.name}</p>
                      <p className="text-xs text-text-secondary mt-0.5">{FENCE_TYPE_LABELS[f.type]}</p>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 gap-0.5">
                        <Button variant="ghost" size="icon" aria-label={`Assign animals to ${f.name}`} onClick={(e) => { e.stopPropagation(); setAssignTarget(f); }}>
                          <Users size={16} strokeWidth={1.5} />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Edit ${f.name}`} onClick={(e) => { e.stopPropagation(); startEdit(f); }}>
                          <Pencil size={16} strokeWidth={1.5} />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Delete ${f.name}`} onClick={(e) => { e.stopPropagation(); setDeleteTarget(f); }}>
                          <Trash2 size={16} strokeWidth={1.5} />
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <span className="tabular-nums text-xs text-text-secondary">{f.animal_count} animal{f.animal_count !== 1 ? "s" : ""}</span>
                    {f.breach_count > 0 ? (
                      <Pill tone="breach" label={`${f.breach_count} breach${f.breach_count > 1 ? "es" : ""}`} />
                    ) : (
                      <Pill tone="inside" label="Clear" />
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
        <NewFenceDialog open={newOpen} fences={features} onClose={() => setNewOpen(false)} onCreated={fetchFences} />
      )}
      {assignTarget && (
        <AssignAnimalsDialog fence={assignTarget} onClose={() => setAssignTarget(null)} onSaved={fetchFences} />
      )}
      {deleteTarget && (
        <DeleteDialog
          fence={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { if (selectedId === deleteTarget.id) setSelectedId(null); fetchFences(); }}
        />
      )}
    </div>
  );
}
