"use client";

import { useEffect, useRef, useState } from "react";
import { X, MapPin, Battery, Signal, Clock, User, Tag, CreditCard, Calendar, AlertTriangle } from "lucide-react";
import { formatRelativeTime, formatAbsoluteTime, formatCoord } from "@/lib/format";
import { cn } from "@/lib/utils";

interface AnimalDetail {
  id:              number;
  animal_name:     string | null;
  species:         string;
  sex:             string | null;
  age_years:       number | null;
  status:          string;
  tag_serial:      string | null;
  last_seen_at:    string | null;
  borrower_name:   string | null;
  cnic:            string | null;
  phone:           string | null;
  address:         string | null;
  loan_number:     string | null;
  amount_pkr:      number | null;
  loan_status:     string | null;
  branch_name:     string;
  region_name:     string | null;
  geofence_name:   string | null;
  warning_buffer_m: number | null;
  lat:             number | null;
  lon:             number | null;
  last_fix_at:     string | null;
  last_battery_pct: number | null;
  last_speed_kmh:  number | null;
  last_signal_bars: number | null;
  events:          Array<{
    id: number;
    type: string;
    severity: string;
    status: string;
    title: string;
    detail: string | null;
    created_at: string;
  }>;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  inside:  { bg: "var(--status-inside-tint)",  text: "var(--status-inside)",  label: "Inside" },
  near:    { bg: "var(--status-near-tint)",    text: "var(--status-near)",    label: "Near boundary" },
  breach:  { bg: "var(--status-breach-tint)",  text: "var(--status-breach)",  label: "Breach" },
  fast:    { bg: "var(--status-fast-tint)",    text: "var(--status-fast)",    label: "Fast movement" },
  stale:   { bg: "var(--status-stale-tint)",   text: "var(--status-stale)",   label: "Offline" },
};

function BatteryBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-text-secondary">—</span>;
  const color = pct < 20 ? "var(--status-breach)" : pct < 50 ? "var(--status-near)" : "var(--status-inside)";
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex h-3 w-6 overflow-hidden rounded-sm border" style={{ borderColor: color }}>
        <span className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </span>
      <span className="tabular-nums text-xs" style={{ color }}>{pct}%</span>
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-secondary">{label}</dt>
      <dd className="text-sm text-text-primary">{value ?? "—"}</dd>
    </div>
  );
}

interface Props {
  animalId: number | null;
  onClose:  () => void;
  onFlyTo?: (animalId: number) => void;
}

type Tab = "location" | "borrower" | "tag" | "events";

export function AnimalDrawer({ animalId, onClose, onFlyTo }: Props) {
  const [data, setData]   = useState<AnimalDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab]     = useState<Tab>("location");

  useEffect(() => {
    if (!animalId) { setData(null); return; }
    setLoading(true);
    fetch(`/api/animals/${animalId}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [animalId]);

  const isOpen = animalId !== null;
  const sty = data ? (STATUS_STYLES[data.status] ?? STATUS_STYLES.inside) : null;

  const TABS: { key: Tab; label: string }[] = [
    { key: "location", label: "Location" },
    { key: "borrower", label: "Borrower & Loan" },
    { key: "tag",      label: "Tag Health" },
    { key: "events",   label: "Events" },
  ];

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="absolute inset-0 z-20 bg-text-primary/10"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          "absolute top-0 right-0 bottom-0 z-30 flex flex-col bg-bg-surface",
          "transition-transform duration-200 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
        style={{
          width: "420px",
          borderLeft: "1px solid var(--border)",
          borderTopLeftRadius: "14px",
          borderBottomLeftRadius: "14px",
          boxShadow: "var(--shadow-float)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between gap-3 border-b px-5 py-4 shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono-ids text-sm truncate">
              {data?.tag_serial ?? "Loading…"}
            </span>
            {sty && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
                style={{ backgroundColor: sty.bg, color: sty.text }}
              >
                {sty.label}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-text-secondary hover:text-text-primary transition-colors"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {/* Mini map placeholder */}
        <div
          className="h-40 shrink-0 flex items-center justify-center"
          style={{ backgroundColor: "#F3EDE3" }}
        >
          {data?.lat && data?.lon ? (
            <MiniMapInline lat={data.lat} lon={data.lon} status={data.status} />
          ) : (
            <MapPin size={24} strokeWidth={1.5} style={{ color: "var(--text-secondary)" }} />
          )}
        </div>

        {/* Tabs */}
        <div
          className="flex gap-0 border-b shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-medium transition-colors border-b-2",
                tab === t.key
                  ? "border-brand text-brand"
                  : "border-transparent text-text-secondary hover:text-text-primary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-md" style={{ backgroundColor: "var(--bg-sunken)" }} />
              ))}
            </div>
          )}

          {!loading && data && tab === "location" && (
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Animal" value={data.animal_name ?? "Unnamed"} />
              <Field label="Species" value={`${data.species}${data.sex ? ` · ${data.sex}` : ""}${data.age_years ? ` · ${data.age_years} yr` : ""}`} />
              <Field label="Latitude"  value={<span className="font-mono-ids">{data.lat !== null ? formatCoord(data.lat) : "—"}</span>} />
              <Field label="Longitude" value={<span className="font-mono-ids">{data.lon !== null ? formatCoord(data.lon) : "—"}</span>} />
              <div className="col-span-2">
                <Field
                  label="Last fix"
                  value={
                    data.last_fix_at ? (
                      <span title={formatAbsoluteTime(data.last_fix_at)}>
                        {formatRelativeTime(data.last_fix_at)}
                      </span>
                    ) : "Never"
                  }
                />
              </div>
              <Field label="Geofence" value={data.geofence_name ?? "None assigned"} />
              <Field label="Branch" value={data.branch_name} />
              {onFlyTo && (
                <div className="col-span-2">
                  <button
                    onClick={() => onFlyTo(data.id)}
                    className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors"
                    style={{ color: "var(--brand)", border: "1px solid var(--brand)" }}
                  >
                    <MapPin size={14} strokeWidth={1.5} />
                    Show on map
                  </button>
                </div>
              )}
            </dl>
          )}

          {!loading && data && tab === "borrower" && (
            <dl className="grid grid-cols-1 gap-4">
              <Field label="Borrower" value={data.borrower_name} />
              <Field label="CNIC" value={<span className="font-mono-ids">{data.cnic ?? "—"}</span>} />
              <Field label="Phone" value={data.phone} />
              <Field label="Address" value={data.address} />
              <div className="h-px" style={{ backgroundColor: "var(--border)" }} />
              <Field label="Loan number" value={<span className="font-mono-ids">{data.loan_number ?? "—"}</span>} />
              <Field label="Amount (PKR)" value={data.amount_pkr ? data.amount_pkr.toLocaleString() : "—"} />
              <Field label="Disbursed" value={data.loan_number && data.amount_pkr ? (data.loan_status ?? "active") : "—"} />
            </dl>
          )}

          {!loading && data && tab === "tag" && (
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Serial" value={<span className="font-mono-ids">{data.tag_serial ?? "—"}</span>} />
              <Field label="Last seen" value={data.last_seen_at ? formatRelativeTime(data.last_seen_at) : "Never"} />
              <Field label="Battery" value={<BatteryBar pct={data.last_battery_pct} />} />
              <Field
                label="Signal"
                value={
                  data.last_signal_bars !== null
                    ? `${data.last_signal_bars}/4 bars`
                    : "—"
                }
              />
              <Field label="Last speed" value={data.last_speed_kmh !== null ? `${data.last_speed_kmh.toFixed(1)} km/h` : "—"} />
              <Field label="Warning buffer" value={data.warning_buffer_m !== null ? `${data.warning_buffer_m} m` : "—"} />
            </dl>
          )}

          {!loading && data && tab === "events" && (
            <div className="flex flex-col gap-0">
              {data.events.length === 0 && (
                <p className="text-sm text-text-secondary">No events for this animal.</p>
              )}
              {data.events.map((ev) => (
                <div
                  key={ev.id}
                  className="border-b py-3"
                  style={{ borderColor: "var(--border)" }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary">{ev.title}</span>
                    <time
                      className="text-[11px] text-text-secondary whitespace-nowrap"
                      title={formatAbsoluteTime(ev.created_at)}
                    >
                      {formatRelativeTime(ev.created_at)}
                    </time>
                  </div>
                  {ev.detail && (
                    <p className="mt-0.5 text-xs text-text-secondary">{ev.detail}</p>
                  )}
                  <span
                    className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: "var(--bg-sunken)", color: "var(--text-secondary)" }}
                  >
                    {ev.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Tiny inline map showing animal position
function MiniMapInline({ lat, lon, status }: { lat: number; lon: number; status: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    let map: any;
    (async () => {
      const ml = await import("maplibre-gl");
      const { buildMapStyle } = await import("@/lib/map-style");
      map = new ml.Map({
        container: ref.current!,
        style: buildMapStyle(process.env.NEXT_PUBLIC_MAPTILER_KEY ?? ""),
        center: [lon, lat],
        zoom: 12,
        interactive: false,
        attributionControl: false,
      });
      map.on("load", () => {
        const STATUS_COLORS: Record<string, string> = {
          inside: "#3E7C59", near: "#B7791F", breach: "#B0172E", fast: "#6D3FA8", stale: "#7A7F87",
        };
        map.addSource("marker", {
          type: "geojson",
          data: { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: {} },
        });
        map.addLayer({
          id: "marker-circle",
          type: "circle",
          source: "marker",
          paint: {
            "circle-radius": 8,
            "circle-color": STATUS_COLORS[status] ?? "#7A7F87",
            "circle-stroke-color": "#FFFFFF",
            "circle-stroke-width": 2,
          },
        });
      });
    })();
    return () => map?.remove();
  }, [lat, lon, status]);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}
