"use client";

import type { ReactNode } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { ErrorState, Skeleton } from "./states";

/**
 * Data table (DESIGN.md §8): 48 px rows, a sticky header on --bg-sunken, no zebra, hover row
 * --bg-sunken, selected row --brand-tint. Put the status column first and "Last fix" as relative
 * time; `onLocate` adds the locate-on-map icon button at the end of every row.
 *
 * It owns the three states every list needs: loading (skeleton rows), error (what failed + retry)
 * and empty (whatever the caller passes, which should be one sentence and one action).
 */
export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Extra classes for the cell (mono IDs, tabular numbers ...). */
  className?: string;
}

interface Selection {
  checked: ReadonlySet<number | string>;
  onToggle: (id: number | string) => void;
  onToggleAll: () => void;
}

interface Props<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  getRowId: (row: T) => number | string;
  /** Names the table for screen readers. */
  label: string;
  loading?: boolean;
  skeletonRows?: number;
  /** When set the table shows the error state instead of rows. */
  error?: { what: string; onRetry: () => void } | null;
  /** Shown when there are no rows (and no error, and not loading). */
  empty: ReactNode;
  selectedId?: number | string | null;
  onRowClick?: (row: T) => void;
  onLocate?: (row: T) => void;
  /** Checkbox column for bulk actions. */
  selection?: Selection;
  className?: string;
}

const HEAD = "sticky top-0 z-10 bg-bg-sunken px-4 py-3 text-left text-xs font-medium uppercase leading-4 tracking-[0.04em] text-text-secondary whitespace-nowrap";

export function DataTable<T>({
  columns, rows, getRowId, label, loading = false, skeletonRows = 8, error = null, empty,
  selectedId = null, onRowClick, onLocate, selection, className,
}: Props<T>) {
  const extra = (onLocate ? 1 : 0) + (selection ? 1 : 0);
  const span = columns.length + extra;
  const allChecked = selection !== undefined && rows.length > 0 && rows.every((r) => selection.checked.has(getRowId(r)));

  return (
    <div className={cn("overflow-auto rounded-[var(--radius-md)] border border-border bg-bg-surface", className)}>
      {error ? (
        <ErrorState what={error.what} onRetry={error.onRetry} />
      ) : (
        <table aria-label={label} aria-busy={loading || undefined} className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {selection && (
                <th className={cn(HEAD, "w-10 pr-2")}>
                  <input type="checkbox" aria-label="Select all" checked={allChecked} onChange={selection.onToggleAll} className="cursor-pointer" />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} scope="col" className={HEAD}>
                  {c.header}
                </th>
              ))}
              {onLocate && (
                <th scope="col" className={cn(HEAD, "w-14")}>
                  <span className="sr-only">Locate on map</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: skeletonRows }).map((_, r) => (
                <tr key={r} className="h-12 border-t border-border" data-testid="skeleton-row">
                  {Array.from({ length: span }).map((__, c) => (
                    <td key={c} className="px-4">
                      <Skeleton className="h-4" style={{ width: `${55 + (((r + 1) * (c + 3) * 13) % 40)}%` }} />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={span}>{empty}</td>
              </tr>
            )}

            {!loading &&
              rows.map((row) => {
                const id = getRowId(row);
                const selected = selectedId !== null && selectedId === id;
                return (
                  <tr
                    key={id}
                    data-selected={selected}
                    aria-selected={onRowClick ? selected : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row); } } : undefined}
                    className={cn(
                      "h-12 border-t border-border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40",
                      onRowClick && "cursor-pointer",
                      selected ? "bg-brand-tint" : "hover:bg-bg-sunken",
                    )}
                  >
                    {selection && (
                      <td className="w-10 pl-4 pr-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select row ${id}`}
                          checked={selection.checked.has(id)}
                          onChange={() => selection.onToggle(id)}
                          className="cursor-pointer"
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={cn("px-4 align-middle", c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                    {onLocate && (
                      <td className="w-14 px-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Locate on map"
                          title="Locate on map"
                          onClick={(e) => { e.stopPropagation(); onLocate(row); }}
                        >
                          <MapPin size={16} strokeWidth={1.5} />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
    </div>
  );
}
