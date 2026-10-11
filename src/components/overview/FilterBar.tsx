"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The Overview's filters, in one row: the animal status as a segmented control (Inside, Near boundary,
 * Breach, Fast movement, Offline) and a "Last fix" dropdown. The KPI cards set the same status filter.
 * (Alert types are not a second set of chips: the status already selects the matching alerts.)
 */
export interface Filters {
  status:  string | null;
  lastFix: string | null;
  /** Kept for the alert feed's own query; the Overview no longer offers it as chips. */
  type:    string | null;
}

interface Props {
  filters:  Filters;
  onChange: (f: Filters) => void;
}

export const STATUS_OPTIONS = [
  { value: "inside", label: "Inside" },
  { value: "near",   label: "Near boundary" },
  { value: "breach", label: "Breach" },
  { value: "fast",   label: "Fast movement" },
  { value: "stale",  label: "Offline" },
] as const;

const LAST_FIX_OPTIONS = [
  { value: "1h",  label: "Under 1 hour" },
  { value: "6h",  label: "1 to 6 hours" },
  { value: "24h", label: "6 to 24 hours" },
];

export function FilterBar({ filters, onChange }: Props) {
  const anyActive = filters.status !== null || filters.lastFix !== null;
  return (
    <div role="toolbar" aria-label="Filters" className="flex flex-wrap items-center gap-3 border-b border-border bg-bg-surface px-4 py-2">
      <span className="text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">Status</span>
      <div role="group" aria-label="Animal status" className="inline-flex overflow-hidden rounded-full border border-border">
        {STATUS_OPTIONS.map((o, i) => {
          const active = filters.status === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...filters, status: active ? null : o.value })}
              className={cn(
                "inline-flex h-8 items-center gap-1 whitespace-nowrap px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40",
                i > 0 && "border-l border-border",
                active ? "bg-brand-tint text-brand-hover" : "bg-bg-surface text-text-secondary hover:bg-bg-sunken hover:text-text-primary",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>

      <span aria-hidden className="h-5 w-px bg-border" />

      <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">
        Last fix
        <select
          value={filters.lastFix ?? ""}
          onChange={(e) => onChange({ ...filters, lastFix: e.target.value || null })}
          className="h-8 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-2 text-xs font-medium normal-case tracking-normal text-text-primary outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
        >
          <option value="">Any time</option>
          {LAST_FIX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      {anyActive && (
        <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => onChange({ status: null, lastFix: null, type: null })}>
          <X size={12} strokeWidth={1.5} aria-hidden /> Clear all
        </Button>
      )}
    </div>
  );
}
