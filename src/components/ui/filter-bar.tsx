"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Filter bar (DESIGN.md §8): chips; the active chip is brand-tint with terracotta text; "Clear all"
 * is a ghost button. Each group is single-choice (click the active chip again to unset it).
 */
export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  key: string;
  /** Names the group for screen readers ("Status"). */
  label: string;
  options: readonly FilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}

export function Chip({ label, active, onClick, testId }: { label: string; active: boolean; onClick: () => void; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40",
        active ? "border-brand bg-brand-tint text-brand-hover" : "border-border bg-bg-surface text-text-secondary hover:border-text-secondary hover:text-text-primary",
      )}
    >
      {label}
      {active && <X size={12} strokeWidth={1.5} aria-hidden />}
    </button>
  );
}

interface Props {
  groups: readonly FilterGroup[];
  /** Shown first, e.g. a search box. */
  leading?: React.ReactNode;
  /** Clears every group at once. Without it each group's own onChange is called with null. */
  onClearAll?: () => void;
  /** A bar inside a page rather than a strip across the full width. */
  inline?: boolean;
  className?: string;
}

export function FilterBar({ groups, leading, onClearAll, inline = false, className }: Props) {
  const anyActive = groups.some((g) => g.value !== null);
  return (
    <div
      role="toolbar"
      aria-label="Filters"
      className={cn("flex items-center gap-2 overflow-x-auto bg-bg-surface", inline ? "flex-wrap py-1" : "border-b border-border px-4 py-2", className)}
    >
      {leading}
      {groups.map((group, gi) => (
        <div key={group.key} role="group" aria-label={group.label} className="flex shrink-0 items-center gap-2">
          {(gi > 0 || leading) && <span aria-hidden className="h-4 w-px shrink-0 bg-border" />}
          {group.options.map((o) => (
            <Chip key={o.value} label={o.label} active={group.value === o.value} onClick={() => group.onChange(group.value === o.value ? null : o.value)} />
          ))}
        </div>
      ))}
      {anyActive && (
        <Button
          variant="ghost"
          className="ml-1 h-7 shrink-0 px-2 text-xs"
          onClick={() => (onClearAll ? onClearAll() : groups.forEach((g) => g.value !== null && g.onChange(null)))}
        >
          Clear all
        </Button>
      )}
    </div>
  );
}

/** A search box that matches the filter bar (tag ID, loan ID, borrower ...). */
export function SearchField({
  value, onChange, placeholder, label = "Search", className,
}: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; className?: string }) {
  return (
    <div className={cn("relative min-w-[200px] max-w-xs flex-1", className)}>
      <Search size={16} strokeWidth={1.5} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 w-full rounded-[var(--radius-sm)] border border-border bg-bg-sunken pl-9 pr-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-secondary focus:border-brand focus:ring-1 focus:ring-brand/30"
      />
    </div>
  );
}
