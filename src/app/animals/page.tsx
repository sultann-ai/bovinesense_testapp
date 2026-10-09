"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, CheckCircle, ShieldAlert, WifiOff, Truck, AlertTriangle, Search, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusKey = "inside" | "near" | "breach" | "fast" | "stale";

interface AnimalRow {
  id: number;
  name: string | null;
  species: string;
  status: StatusKey;
  tag_serial: string | null;
  borrower_name: string | null;
  loan_number: string | null;
  branch_name: string;
  district: string | null;
  last_fix_at: string | null;
  battery_pct: number | null;
  lat: number | null;
  lon: number | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<StatusKey, { icon: React.ElementType; solid: string; tint: string; label: string }> = {
  inside: { icon: CheckCircle,   solid: "var(--status-inside)", tint: "var(--status-inside-tint)", label: "Inside" },
  near:   { icon: AlertTriangle, solid: "var(--status-near)",   tint: "var(--status-near-tint)",   label: "Near boundary" },
  breach: { icon: ShieldAlert,   solid: "var(--status-breach)", tint: "var(--status-breach-tint)", label: "Breach" },
  fast:   { icon: Truck,         solid: "var(--status-fast)",   tint: "var(--status-fast-tint)",   label: "Fast movement" },
  stale:  { icon: WifiOff,       solid: "var(--status-stale)",  tint: "var(--status-stale-tint)",  label: "Offline" },
};

const STATUS_FILTERS: { value: StatusKey | ""; label: string }[] = [
  { value: "",        label: "All" },
  { value: "breach",  label: "Breach" },
  { value: "near",    label: "Near boundary" },
  { value: "inside",  label: "Inside" },
  { value: "stale",   label: "Offline" },
  { value: "fast",    label: "Fast movement" },
];

const STALE_HOURS = 6;

// Lazy-load AnimalDrawer (needs MapLibre — browser only)
const AnimalDrawer = dynamic(
  () => import("@/components/overview/AnimalDrawer").then((m) => ({ default: m.AnimalDrawer })),
  { ssr: false },
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): { text: string; stale: boolean } {
  if (!iso) return { text: "No fix", stale: true };
  const diffH = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (diffH >= STALE_HOURS) return { text: `${Math.floor(diffH)} h ago`, stale: true };
  const diffM = diffH * 60;
  if (diffM < 2) return { text: "Just now", stale: false };
  if (diffM < 60) return { text: `${Math.floor(diffM)} min ago`, stale: false };
  return { text: `${diffH.toFixed(1)} h ago`, stale: false };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: StatusKey }) {
  const cfg  = STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: cfg.tint, color: cfg.solid }}
    >
      <Icon size={11} strokeWidth={1.5} />
      {cfg.label}
    </span>
  );
}

function BatteryBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-text-secondary">—</span>;
  const color = pct > 40 ? "var(--status-inside)" : pct > 20 ? "var(--status-near)" : "var(--status-breach)";
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-14 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bg-sunken)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="tabular-nums text-xs text-text-secondary">{pct}%</span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded animate-pulse" style={{ backgroundColor: "var(--bg-sunken)", width: `${55 + (i * 13) % 45}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AnimalsPage() {
  const router = useRouter();
  const [animals,    setAnimals]    = useState<AnimalRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error503,   setError503]   = useState(false);
  const [q,          setQ]          = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusKey | "">("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQ, setDebouncedQ] = useState("");

  // Debounce the search query
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(q), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  const fetchAnimals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQ)   params.set("q", debouncedQ);
      if (statusFilter) params.set("status", statusFilter);
      const rows = await fetch(`/api/animals?${params}`).then((r) => r.json());
      if (!Array.isArray(rows)) { setError503(true); return; }
      setAnimals(rows);
      setError503(false);
    } catch {
      setError503(true);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, statusFilter]);

  useEffect(() => { fetchAnimals(); }, [fetchAnimals]);

  function locateOnMap(id: number) {
    router.push(`/?animal=${id}`);
  }

  return (
    <div className="flex h-full gap-0 -m-6 overflow-hidden">
      {/* Table area */}
      <div className="flex flex-1 flex-col overflow-hidden p-6">
        {/* Header */}
        <div className="mb-5">
          <h1 className="text-2xl font-semibold text-text-primary">Animals</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Searchable table of all tagged animals with live status.
          </p>
        </div>

        {/* Search + filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tag ID, loan ID, borrower…"
              className="w-full rounded-[var(--radius-sm)] border py-[7px] pl-9 pr-3 text-sm outline-none transition-colors"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--bg-sunken)",
                color: "var(--text-primary)",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--brand)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
            />
          </div>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value as StatusKey | "")}
              className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              style={{
                borderColor:     statusFilter === f.value ? "var(--brand)" : "var(--border)",
                backgroundColor: statusFilter === f.value ? "var(--brand-tint)" : "var(--bg-surface)",
                color:           statusFilter === f.value ? "var(--brand)" : "var(--text-secondary)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div
          className="flex-1 overflow-auto rounded-[var(--radius-md)] border"
          style={{ borderColor: "var(--border)" }}
        >
          {error503 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <p className="text-sm text-text-secondary">Could not connect to database.</p>
              <button
                onClick={fetchAnimals}
                className="rounded-[var(--radius-sm)] border px-4 py-2 text-xs font-medium text-text-secondary hover:bg-bg-sunken transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                Retry
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: "var(--bg-sunken)" }}>
                  {["Status", "Tag ID", "Borrower", "Loan ID", "District", "Last fix", "Battery", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.04em] text-text-secondary whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                ) : animals.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center">
                      <p className="text-sm text-text-secondary">
                        {debouncedQ || statusFilter ? "No animals matching these filters." : "No animals found."}
                      </p>
                      {(debouncedQ || statusFilter) && (
                        <button
                          onClick={() => { setQ(""); setStatusFilter(""); }}
                          className="mt-2 text-xs"
                          style={{ color: "var(--brand-hover)" }}
                        >
                          Clear filters
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  animals.map((a) => {
                    const fix = relativeTime(a.last_fix_at);
                    return (
                      <tr
                        key={a.id}
                        onClick={() => setSelectedId(selectedId === a.id ? null : a.id)}
                        className="cursor-pointer transition-colors"
                        style={{
                          backgroundColor: selectedId === a.id ? "var(--brand-tint)" : undefined,
                        }}
                        onMouseEnter={(e) => {
                          if (selectedId !== a.id) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-sunken)";
                        }}
                        onMouseLeave={(e) => {
                          if (selectedId !== a.id) (e.currentTarget as HTMLElement).style.backgroundColor = "";
                        }}
                      >
                        <td className="px-4 py-3"><StatusPill status={a.status} /></td>
                        <td className="px-4 py-3 font-mono-ids text-text-primary">{a.tag_serial ?? "—"}</td>
                        <td className="px-4 py-3 text-text-primary">{a.borrower_name ?? "—"}</td>
                        <td className="px-4 py-3 font-mono-ids text-text-secondary">{a.loan_number ?? "—"}</td>
                        <td className="px-4 py-3 text-text-secondary">{a.district ?? "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {fix.stale && (
                              <Clock size={12} strokeWidth={1.5} style={{ color: "var(--status-stale)", flexShrink: 0 }} />
                            )}
                            <span
                              className="text-xs"
                              style={{ color: fix.stale ? "var(--status-stale)" : "var(--text-secondary)" }}
                            >
                              {fix.text}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3"><BatteryBar pct={a.battery_pct} /></td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); locateOnMap(a.id); }}
                            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                            style={{ borderColor: "var(--border)" }}
                          >
                            <MapPin size={12} strokeWidth={1.5} />
                            Locate
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Animal drawer reused here */}
      <AnimalDrawer
        animalId={selectedId}
        onClose={() => setSelectedId(null)}
        onFlyTo={(id) => locateOnMap(id)}
      />
    </div>
  );
}
