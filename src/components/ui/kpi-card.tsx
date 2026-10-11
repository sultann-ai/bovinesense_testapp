import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./states";

/**
 * KPI card (DESIGN.md §8): surface, 1 px border, 10 px radius, 20 px padding. Label (12, uppercase),
 * value (36, semibold, tabular), the icon in a tinted circle, a line against yesterday (13, green or
 * crimson with an arrow). The breach card gets a 3 px crimson top bar when its value is above zero.
 * With `onClick` the whole card is a button (the Overview uses it to filter the map and the feed).
 */
interface Delta {
  /** Signed change. */
  value: number;
  /** Whether an increase is good news (animals inside) or bad (breaches). */
  upIsGood: boolean;
  label?: string;
}

/** The tinted circle behind the icon: terracotta for animals, green inside, crimson breaches, grey offline. */
export type KpiTone = "brand" | "inside" | "breach" | "stale";

const TONES: Record<KpiTone, string> = {
  brand: "bg-brand-tint text-brand-hover",
  inside: "bg-status-inside-tint text-status-inside-text",
  breach: "bg-status-breach-tint text-status-breach",
  stale: "bg-status-stale-tint text-status-stale-text",
};

interface Props {
  label: string;
  value: string;
  /** A line under the value ("2 of 3"). */
  caption?: string;
  icon?: LucideIcon;
  tone?: KpiTone;
  /** Marks the card as the breach card: crimson value and top bar while `alert` is true. */
  alert?: boolean;
  /** Change against yesterday; `null` says there is no history to compare with. Omit to show nothing. */
  delta?: Delta | null;
  loading?: boolean;
  /** Makes the card a button. */
  onClick?: () => void;
  /** Whether this card's filter is the one applied (only meaningful with `onClick`). */
  active?: boolean;
  className?: string;
}

export function KpiCard({ label, value, caption, icon: Icon, tone = "brand", alert = false, delta, loading = false, onClick, active = false, className }: Props) {
  const good = delta ? delta.value > 0 === delta.upIsGood : false;
  const classes = cn(
    "relative flex w-full flex-col justify-center overflow-hidden rounded-[var(--radius-md)] border bg-bg-surface p-5 text-left",
    active ? "border-brand" : "border-border",
    onClick && "cursor-pointer outline-none transition-colors hover:bg-bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40",
    className,
  );

  const body = (
    <>
      {alert && <div data-testid="kpi-alert-bar" className="absolute inset-x-0 top-0 h-[3px] bg-status-breach" />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase leading-4 tracking-[0.04em] text-text-secondary">{label}</div>
          {loading ? (
            <Skeleton className="h-10 w-20" />
          ) : (
            <div className={cn("text-[2.25rem] font-semibold leading-10 tabular-nums", alert ? "text-status-breach" : "text-text-primary")}>{value}</div>
          )}
        </div>
        {Icon && (
          <span aria-hidden data-testid="kpi-icon" className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", TONES[tone])}>
            <Icon size={20} strokeWidth={1.5} />
          </span>
        )}
      </div>
      {!loading && caption && (
        <div className={cn("mt-1 text-[0.8125rem] leading-[1.125rem]", alert ? "text-status-breach" : "text-text-secondary")}>{caption}</div>
      )}
      {!loading && delta === null && (
        <div data-testid="kpi-delta-none" className="mt-1 text-[0.8125rem] leading-[1.125rem] text-text-secondary">No yesterday data</div>
      )}
      {!loading && delta && delta.value === 0 && (
        <div data-testid="kpi-delta-none" className="mt-1 text-[0.8125rem] leading-[1.125rem] text-text-secondary">No change vs yesterday</div>
      )}
      {!loading && delta && delta.value !== 0 && (
        <div
          data-testid="kpi-delta"
          className={cn("mt-1 inline-flex items-center gap-1 text-[0.8125rem] leading-[1.125rem]", good ? "text-status-inside-text" : "text-status-breach")}
        >
          {delta.value > 0 ? <ArrowUp size={12} strokeWidth={1.5} aria-hidden /> : <ArrowDown size={12} strokeWidth={1.5} aria-hidden />}
          {Math.abs(delta.value)} {delta.label ?? "vs yesterday"}
        </div>
      )}
    </>
  );

  return onClick ? (
    <button type="button" data-testid="kpi-card" data-alert={alert} aria-pressed={active} aria-label={`${label}: ${loading ? "loading" : value}. Filter the map and alerts.`} onClick={onClick} className={classes}>
      {body}
    </button>
  ) : (
    <div data-testid="kpi-card" data-alert={alert} className={classes}>
      {body}
    </div>
  );
}
