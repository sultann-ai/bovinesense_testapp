"use client";

import { useCallback, useEffect, useState } from "react";
import { Tag } from "lucide-react";
import { BatteryGlyph, SignalGlyph } from "@/components/ui/battery-signal";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/states";
import { Timestamp } from "@/components/ui/timestamp";
import { useTenant } from "@/components/shell/TenantProvider";
import { useResync } from "@/components/realtime/RealtimeProvider";

interface DeviceRow {
  id: number;
  serial_number: string;
  is_simulated: boolean;
  last_seen_at: string | null;
  animal_id: number | null;
  animal_name: string | null;
  is_unassigned: boolean;
  battery_pct: number | null;
  signal_bars: number | null;
}

/** Read-only tag inventory: unassigned tags first, then the quietest tags. */
export function DevicesTable() {
  const { offlineThresholdHours } = useTenant();
  const [result, setResult] = useState<{ rows: DeviceRow[]; failed: boolean } | null>(null);

  const load = useCallback(() => {
    return fetch("/api/devices", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: unknown) => {
        if (!Array.isArray(rows)) throw new Error("unexpected response");
        setResult({ rows, failed: false });
      })
      .catch(() => setResult({ rows: [], failed: true }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/devices", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: unknown) => {
        if (!Array.isArray(rows)) throw new Error("unexpected response");
        if (!cancelled) setResult({ rows, failed: false });
      })
      .catch(() => { if (!cancelled) setResult({ rows: [], failed: true }); });
    return () => { cancelled = true; };
  }, []);
  useResync(() => { void load(); });

  const columns: Column<DeviceRow>[] = [
    {
      key: "assignment",
      header: "Assignment",
      cell: (d) => d.is_unassigned ? <Pill tone="near" label="Unassigned" /> : <Pill tone="inside" label="Assigned" />,
    },
    {
      key: "serial",
      header: "Tag ID",
      cell: (d) => <>{d.serial_number}{d.is_simulated && <span className="ml-2 text-xs text-text-secondary">simulated</span>}</>,
      className: "font-mono-ids text-text-primary",
    },
    { key: "animal", header: "Animal", cell: (d) => d.animal_name ?? (d.animal_id !== null ? `Animal ${d.animal_id}` : "—"), className: "text-text-secondary" },
    { key: "battery", header: "Battery", cell: (d) => <BatteryGlyph pct={d.battery_pct} /> },
    { key: "signal", header: "Signal", cell: (d) => <SignalGlyph bars={d.signal_bars} /> },
    { key: "contact", header: "Last contact", cell: (d) => <Timestamp value={d.last_seen_at} staleAfterHours={offlineThresholdHours} empty="Never" /> },
  ];

  return (
    <DataTable
      className="max-h-[560px]"
      label="Tags"
      columns={columns}
      rows={result?.rows ?? []}
      getRowId={(d) => d.id}
      loading={result === null}
      error={result?.failed ? { what: "The tags could not be loaded.", onRetry: () => { setResult(null); void load(); } } : null}
      empty={<EmptyState icon={<Tag size={20} strokeWidth={1.5} />} title="No tags are registered in this view yet." />}
    />
  );
}
