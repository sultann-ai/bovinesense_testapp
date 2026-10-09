"use client";

import { ShieldAlert, Truck, WifiOff, Battery, Info, CheckCircle, ArrowRight, MapPin } from "lucide-react";
import { formatRelativeTime, formatAbsoluteTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface AlertRow {
  id:              number;
  type:            string;
  severity:        string;
  status:          string;
  title:           string;
  detail:          string | null;
  distance_km:     number | null;
  created_at:      string;
  animal_id:       number;
  animal_name:     string | null;
  tag_serial:      string | null;
  borrower_name:   string | null;
  loan_number:     string | null;
  branch_name:     string;
}

interface Props {
  alerts:          AlertRow[];
  loading:         boolean;
  total:           number;
  selectedId:      number | null;
  onSelectAnimal:  (id: number) => void;
  onAcknowledge:   (id: number) => void;
  onFlyTo:         (animalId: number) => void;
}

const SEV: Record<string, { bar: string; icon: typeof ShieldAlert }> = {
  breach:        { bar: "var(--status-breach)", icon: ShieldAlert },
  near_boundary: { bar: "var(--status-near)",   icon: ShieldAlert },
  fast_movement: { bar: "var(--status-fast)",   icon: Truck },
  tag_offline:   { bar: "var(--status-stale)",  icon: WifiOff },
  low_battery:   { bar: "var(--status-info)",   icon: Battery },
  returned:      { bar: "var(--status-info)",   icon: CheckCircle },
};

function AlertCard({ alert, selectedAnimalId, onSelectAnimal, onAcknowledge, onFlyTo }: {
  alert:           AlertRow;
  selectedAnimalId: number | null;
  onSelectAnimal:  (id: number) => void;
  onAcknowledge:   (id: number) => void;
  onFlyTo:         (animalId: number) => void;
}) {
  const s = SEV[alert.type] ?? SEV.returned;
  const isSelected = selectedAnimalId === alert.animal_id;
  const isNew = alert.status === "new";

  return (
    <div
      className={cn(
        "relative flex cursor-pointer gap-0 border-b transition-colors",
        isSelected ? "bg-brand-tint" : "bg-bg-surface hover:bg-bg-sunken",
      )}
      style={{ borderColor: "var(--border)" }}
      onClick={() => onSelectAnimal(alert.animal_id)}
    >
      {/* 4px severity bar */}
      <div className="w-1 shrink-0" style={{ backgroundColor: s.bar }} />

      {/* Unread dot */}
      {isNew && (
        <div
          className="absolute right-3 top-3 h-2 w-2 rounded-full"
          style={{ backgroundColor: s.bar }}
        />
      )}

      <div className="flex-1 min-w-0 p-3">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <span className="text-sm font-semibold text-text-primary leading-tight pr-4">
            {alert.title}
          </span>
          <time
            className="text-[11px] text-text-secondary whitespace-nowrap shrink-0"
            title={formatAbsoluteTime(alert.created_at)}
          >
            {formatRelativeTime(alert.created_at)}
          </time>
        </div>

        <div className="font-mono-ids text-[11px] text-text-secondary mb-0.5 truncate">
          {alert.tag_serial ?? "—"} · {alert.borrower_name ?? "—"} · {alert.loan_number ?? "—"}
        </div>

        <div className="text-[11px] text-text-secondary truncate">
          {alert.branch_name}
          {alert.detail && ` · ${alert.detail}`}
        </div>

        {/* Actions */}
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); onFlyTo(alert.animal_id); }}
            className="flex items-center gap-1 text-[11px] font-medium transition-colors"
            style={{ color: "var(--brand)" }}
          >
            <MapPin size={10} strokeWidth={2} />
            View on map
          </button>

          {isNew && (
            <button
              onClick={(e) => { e.stopPropagation(); onAcknowledge(alert.id); }}
              className="flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              <CheckCircle size={10} strokeWidth={2} />
              Acknowledge
            </button>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onSelectAnimal(alert.animal_id); }}
            className="flex items-center gap-1 text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowRight size={10} strokeWidth={2} />
            Open
          </button>
        </div>
      </div>
    </div>
  );
}

export function AlertFeed({
  alerts, loading, total,
  selectedId, onSelectAnimal, onAcknowledge, onFlyTo,
}: Props) {
  return (
    <div
      className="flex w-[360px] shrink-0 flex-col border-l overflow-hidden"
      style={{ borderColor: "var(--border)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3 bg-bg-surface shrink-0 z-10"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-sm font-semibold text-text-primary">Live Alerts</span>
        {total > 0 && (
          <span
            className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold text-white tabular-nums"
            style={{ backgroundColor: "var(--status-breach)" }}
          >
            {total}
          </span>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col gap-px p-0">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[88px] animate-pulse" style={{ backgroundColor: "var(--bg-sunken)" }} />
            ))}
          </div>
        )}

        {!loading && alerts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <CheckCircle size={24} strokeWidth={1.5} style={{ color: "var(--status-inside)" }} />
            <p className="text-sm text-text-secondary">All clear</p>
          </div>
        )}

        {!loading && alerts.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            selectedAnimalId={selectedId}
            onSelectAnimal={onSelectAnimal}
            onAcknowledge={onAcknowledge}
            onFlyTo={onFlyTo}
          />
        ))}
      </div>
    </div>
  );
}
