"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar, SearchField } from "@/components/ui/filter-bar";
import { StatusPill } from "@/components/ui/status-pill";
import { BatteryGlyph } from "@/components/ui/battery-signal";
import { Timestamp } from "@/components/ui/timestamp";
import { EmptyState } from "@/components/ui/states";
import { useScope } from "@/components/shell/ScopeProvider";
import { useTenant } from "@/components/shell/TenantProvider";
import { useLiveEvents, useResync } from "@/components/realtime/RealtimeProvider";

interface AnimalRow {
  id: number;
  name: string | null;
  species: string;
  status: string;
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

const STATUS_FILTERS = [
  { value: "breach", label: "Breach" },
  { value: "near",   label: "Near boundary" },
  { value: "inside", label: "Inside boundary" },
  { value: "stale",  label: "Offline" },
  { value: "fast",   label: "Fast movement" },
];

// The drawer draws a Google map, which exists only in the browser.
const AnimalDrawer = dynamic(
  () => import("@/components/overview/AnimalDrawer").then((m) => ({ default: m.AnimalDrawer })),
  { ssr: false },
);

export default function AnimalsPage() {
  const router = useRouter();
  const scope = useScope();
  const { offlineThresholdHours } = useTenant();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  // One request per (search, status, scope). Until its answer arrives the table shows skeleton rows;
  // a live refresh just asks again and swaps the rows in place.
  const scopeKey = scope.key;
  const queryKey = `${debouncedQ}|${statusFilter ?? ""}|${scopeKey}`;
  const [result, setResult] = useState<{ key: string; rows: AnimalRow[]; failed: boolean } | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (statusFilter) params.set("status", statusFilter);
    fetch(scope.scoped(`/api/animals?${params}`), { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((rows: unknown) => {
        if (!Array.isArray(rows)) throw new Error("unexpected response");
        if (!cancelled) setResult({ key: queryKey, rows, failed: false });
      })
      .catch(() => { if (!cancelled) setResult({ key: queryKey, rows: [], failed: true }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope.scoped changes with scopeKey, which is in queryKey
  }, [queryKey, refresh]);

  const loading = result === null || result.key !== queryKey;
  const animals = result?.rows ?? [];
  const failed = !loading && result.failed;
  const reload = () => setRefresh((n) => n + 1);
  const retry = () => { setResult(null); reload(); };

  // Statuses change as fixes and alerts arrive; refresh once things settle, and after a reconnect.
  useLiveEvents((e) => {
    if (e.kind === "animal") reload();
  });
  useResync(reload);

  const columns: Column<AnimalRow>[] = [
    { key: "status", header: "Status", cell: (a) => <StatusPill status={a.status} /> },
    { key: "tag", header: "Tag ID", cell: (a) => a.tag_serial ?? "—", className: "font-mono-ids text-text-primary" },
    { key: "borrower", header: "Borrower", cell: (a) => a.borrower_name ?? "—", className: "text-text-primary" },
    { key: "loan", header: "Loan ID", cell: (a) => a.loan_number ?? "—", className: "font-mono-ids text-text-secondary" },
    { key: "district", header: "District", cell: (a) => a.district ?? "—", className: "text-text-secondary" },
    {
      key: "fix",
      header: "Last fix",
      cell: (a) => <Timestamp value={a.last_fix_at} staleAfterHours={offlineThresholdHours} empty="No fix" />,
    },
    { key: "battery", header: "Battery", cell: (a) => <BatteryGlyph pct={a.battery_pct} /> },
  ];

  const filtered = debouncedQ !== "" || statusFilter !== null;
  const clearFilters = () => { setQ(""); setDebouncedQ(""); setStatusFilter(null); };

  return (
    <div className="relative -m-6 flex h-full overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold leading-8 text-text-primary">Animals</h1>
          <p className="mt-1 text-sm text-text-secondary">Every tagged animal in view, with its status and last fix.</p>
        </div>

        <div className="mb-4">
          <FilterBar
            inline
            leading={<SearchField value={q} onChange={setQ} placeholder="Tag ID, loan ID, borrower…" label="Search animals" />}
            groups={[{ key: "status", label: "Status", options: STATUS_FILTERS, value: statusFilter, onChange: setStatusFilter }]}
            onClearAll={clearFilters}
          />
        </div>

        <DataTable
          className="flex-1"
          label="Animals"
          columns={columns}
          rows={animals}
          getRowId={(a) => a.id}
          loading={loading}
          error={failed ? { what: "The animals could not be loaded.", onRetry: retry } : null}
          selectedId={selectedId}
          onRowClick={(a) => setSelectedId(selectedId === a.id ? null : a.id)}
          onLocate={(a) => router.push(`/?animal=${a.id}`)}
          empty={
            filtered ? (
              <EmptyState title="No animals match these filters." action={{ label: "Clear filters", onClick: clearFilters }} />
            ) : (
              <EmptyState title="No animals are tracked in this view yet." action={{ label: "Open Devices", href: "/devices" }} />
            )
          }
        />
      </div>

      <AnimalDrawer animalId={selectedId} onClose={() => setSelectedId(null)} onFlyTo={(id) => router.push(`/?animal=${id}`)} />
    </div>
  );
}
