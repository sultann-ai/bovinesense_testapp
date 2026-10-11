"use client";

import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAbsoluteTime, formatRelativeTime, hoursSince } from "@/lib/format";
import { useTenant } from "@/components/shell/TenantProvider";

/**
 * Timestamp (DESIGN.md §8): relative text ("23 min ago") with the exact time, in the tenant's
 * timezone, on hover. Once older than `staleAfterHours` it turns grey with a clock icon, so an old
 * position never reads as current. With no value it says so ("No fix") and counts as stale.
 */
interface Props {
  value: string | null | undefined;
  /** Past this many hours the timestamp is shown as stale. Omit for times that can never be stale. */
  staleAfterHours?: number;
  /** Text for "no value". */
  empty?: string;
  className?: string;
}

export function Timestamp({ value, staleAfterHours, empty = "Never", className }: Props) {
  const { timezone } = useTenant();
  const age = hoursSince(value);
  const stale = staleAfterHours !== undefined && (age === null || age >= staleAfterHours);

  if (!value || age === null) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs", stale ? "text-status-stale-text" : "text-text-secondary", className)}>
        {stale && <Clock size={12} strokeWidth={1.5} aria-hidden />}
        {empty}
      </span>
    );
  }

  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={formatAbsoluteTime(value, timezone)}
      data-stale={stale}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap text-xs", stale ? "text-status-stale-text" : "text-text-secondary", className)}
    >
      {stale && <Clock size={12} strokeWidth={1.5} aria-hidden />}
      {formatRelativeTime(value)}
    </time>
  );
}
