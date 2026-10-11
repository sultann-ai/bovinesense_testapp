"use client";

import { PawPrint, AlertTriangle, CheckCircle, WifiOff } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { ErrorState } from "@/components/ui/states";
import { useTenant } from "@/components/shell/TenantProvider";

export interface KpiData {
  total:        number;
  inside_count: number;
  inside_pct:   number;
  breach_count: number;
  stale_count:  number;
  new_alerts:   number;
  /** Change over the last 24 h; null when it could not be worked out. */
  delta?:       { total: number; breach_count: number; stale_count: number } | null;
}

interface Props {
  data: KpiData | null;
  loading?: boolean;
  /** Set when the numbers could not be loaded. */
  onRetry?: () => void;
  /** The animal status the map and feed are filtered to, if any. */
  activeStatus?: string | null;
  /** Clicking a card filters the map and the feed to that status; clicking the applied one clears it. */
  onSelectStatus?: (status: string | null) => void;
}

/** The four numbers across the top of the Overview, as KPI cards. */
export function KpiStrip({ data, loading = false, onRetry, activeStatus = null, onSelectStatus }: Props) {
  const { offlineThresholdHours } = useTenant();

  if (!loading && data === null && onRetry) {
    return <ErrorState className="border-b border-border py-6" what="The summary numbers could not be loaded." onRetry={onRetry} />;
  }

  const breaches = data?.breach_count ?? 0;
  const d = data?.delta;
  const select = (status: string | null) => (onSelectStatus ? () => onSelectStatus(status !== null && status === activeStatus ? null : status) : undefined);

  return (
    <div className="grid grid-cols-4 gap-4 border-b border-border bg-bg-app p-4" aria-label="Summary">
      <KpiCard
        label="Animals monitored"
        value={String(data?.total ?? 0)}
        caption="tags active"
        icon={PawPrint}
        tone="brand"
        delta={d ? { value: d.total, upIsGood: true } : undefined}
        loading={loading}
        onClick={select(null)}
      />
      <KpiCard
        label="Inside boundary"
        value={`${data?.inside_pct ?? 0}%`}
        caption={`${data?.inside_count ?? 0} of ${data?.total ?? 0}`}
        icon={CheckCircle}
        tone="inside"
        delta={data ? null : undefined}
        loading={loading}
        active={activeStatus === "inside"}
        onClick={select("inside")}
      />
      <KpiCard
        label="Active breaches"
        value={String(breaches)}
        caption="animals outside"
        icon={AlertTriangle}
        tone="breach"
        alert={breaches > 0}
        delta={d ? { value: d.breach_count, upIsGood: false } : undefined}
        loading={loading}
        active={activeStatus === "breach"}
        onClick={select("breach")}
      />
      <KpiCard
        label="Offline tags"
        value={String(data?.stale_count ?? 0)}
        caption={`no fix > ${offlineThresholdHours} h`}
        icon={WifiOff}
        tone="stale"
        delta={d ? { value: d.stale_count, upIsGood: false } : undefined}
        loading={loading}
        active={activeStatus === "stale"}
        onClick={select("stale")}
      />
    </div>
  );
}
