"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Filters {
  status:  string | null;
  lastFix: string | null;
  type:    string | null;
}

interface Props {
  filters:  Filters;
  onChange: (f: Filters) => void;
}

const STATUS_OPTIONS = [
  { value: "breach",      label: "Breach" },
  { value: "near",        label: "Near boundary" },
  { value: "fast",        label: "Fast movement" },
  { value: "stale",       label: "Offline" },
];

const TYPE_OPTIONS = [
  { value: "breach",        label: "Breach alert" },
  { value: "near_boundary", label: "Near boundary" },
  { value: "fast_movement", label: "Fast movement" },
  { value: "tag_offline",   label: "Offline" },
  { value: "low_battery",   label: "Low battery" },
];

const LAST_FIX_OPTIONS = [
  { value: "1h",  label: "< 1 h" },
  { value: "6h",  label: "1–6 h" },
  { value: "24h", label: "6–24 h" },
];

function Chip({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-brand bg-brand-tint text-brand"
          : "border-border bg-bg-surface text-text-secondary hover:border-text-secondary hover:text-text-primary",
      )}
    >
      {label}
      {active && <X size={10} strokeWidth={2} />}
    </button>
  );
}

export function FilterBar({ filters, onChange }: Props) {
  const hasAny = filters.status || filters.lastFix || filters.type;

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-surface)" }}
    >
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-secondary shrink-0">
        Filter
      </span>

      {STATUS_OPTIONS.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          active={filters.status === o.value}
          onClick={() =>
            onChange({ ...filters, status: filters.status === o.value ? null : o.value })
          }
        />
      ))}

      <div className="h-4 w-px shrink-0" style={{ backgroundColor: "var(--border)" }} />

      {TYPE_OPTIONS.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          active={filters.type === o.value}
          onClick={() =>
            onChange({ ...filters, type: filters.type === o.value ? null : o.value })
          }
        />
      ))}

      <div className="h-4 w-px shrink-0" style={{ backgroundColor: "var(--border)" }} />

      {LAST_FIX_OPTIONS.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          active={filters.lastFix === o.value}
          onClick={() =>
            onChange({ ...filters, lastFix: filters.lastFix === o.value ? null : o.value })
          }
        />
      ))}

      {hasAny && (
        <>
          <div className="h-4 w-px shrink-0" style={{ backgroundColor: "var(--border)" }} />
          <button
            onClick={() => onChange({ status: null, lastFix: null, type: null })}
            className="text-[11px] font-medium text-text-secondary hover:text-text-primary transition-colors shrink-0"
          >
            Clear all
          </button>
        </>
      )}
    </div>
  );
}
