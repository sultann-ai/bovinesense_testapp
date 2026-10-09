"use client";

import { PawPrint, AlertTriangle, CheckCircle, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KpiData {
  total:        number;
  inside_count: number;
  inside_pct:   number;
  breach_count: number;
  stale_count:  number;
  new_alerts:   number;
}

interface Props {
  data: KpiData | null;
  loading?: boolean;
}

export function KpiStrip({ data, loading }: Props) {
  const cards = [
    {
      label: "Animals Tracked",
      value: loading ? "—" : String(data?.total ?? 0),
      sub:   loading ? "" : "tags active",
      icon:  PawPrint,
      breach: false,
    },
    {
      label: "Inside Boundary",
      value: loading ? "—" : `${data?.inside_pct ?? 0}%`,
      sub:   loading ? "" : `${data?.inside_count ?? 0} of ${data?.total ?? 0}`,
      icon:  CheckCircle,
      breach: false,
    },
    {
      label: "Active Breaches",
      value: loading ? "—" : String(data?.breach_count ?? 0),
      sub:   loading ? "" : "open alerts",
      icon:  AlertTriangle,
      breach: (data?.breach_count ?? 0) > 0,
    },
    {
      label: "Offline Tags",
      value: loading ? "—" : String(data?.stale_count ?? 0),
      sub:   loading ? "" : "no fix > 6 h",
      icon:  WifiOff,
      breach: false,
    },
  ];

  return (
    <div
      className="grid grid-cols-4 gap-px border-b"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--border)" }}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          className="relative flex flex-col justify-center bg-bg-surface px-6"
          style={{ height: "96px" }}
        >
          {card.breach && (
            <div
              className="absolute top-0 left-0 right-0 h-[3px] rounded-t"
              style={{ backgroundColor: "var(--status-breach)" }}
            />
          )}
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-secondary mb-1.5">
                {card.label}
              </div>
              <div
                className={cn(
                  "text-[2rem] font-semibold tabular-nums leading-none",
                  card.breach ? "text-status-breach" : "text-text-primary",
                  loading && "opacity-40",
                )}
              >
                {card.value}
              </div>
            </div>
            <card.icon
              size={18}
              strokeWidth={1.5}
              className="mt-0.5 shrink-0"
              style={{ color: card.breach ? "var(--status-breach)" : "var(--text-secondary)" }}
            />
          </div>
          <div
            className="mt-1.5 text-xs"
            style={{ color: card.breach ? "var(--status-breach)" : "var(--text-secondary)" }}
          >
            {card.sub}
          </div>
        </div>
      ))}
    </div>
  );
}
