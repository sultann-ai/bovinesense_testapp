import { cn } from "@/lib/utils";

/**
 * Battery and signal (DESIGN.md §8): 4-bar mini glyphs, grey to amber to red by level, the exact
 * value on hover. The level is also in the text next to the glyph and in its accessible name, so
 * it is never conveyed by colour alone.
 */
const BARS = 4;

/** One bar left is red, two is amber, more is grey. `lowest` is the count that counts as empty. */
function toneOf(filled: number, lowest: number): string {
  if (filled <= lowest + 0) return "bg-status-breach";
  if (filled <= lowest + 1) return "bg-status-near";
  return "bg-status-stale";
}

function Bars({ filled, tone, label }: { filled: number; tone: string; label: string }) {
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-end gap-px" style={{ height: 14 }}>
      {Array.from({ length: BARS }).map((_, i) => (
        <span key={i} className={cn("w-[3px] rounded-[1px]", i < filled ? tone : "bg-border")} style={{ height: 4 + i * 3 }} />
      ))}
    </span>
  );
}

/** Battery charge, 0-100, as 4 bars (one bar is under 25%, around the low-battery warning). */
export function BatteryGlyph({ pct, className }: { pct: number | null | undefined; className?: string }) {
  if (pct === null || pct === undefined) return <span className={cn("text-xs text-text-secondary", className)}>—</span>;
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = clamped === 0 ? 0 : Math.min(BARS, Math.ceil(clamped / 25));
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Bars filled={filled} tone={toneOf(filled, 1)} label={`Battery ${clamped}%`} />
      <span className="text-xs tabular-nums text-text-secondary">{clamped}%</span>
    </span>
  );
}

/** Signal strength as 0-4 bars. */
export function SignalGlyph({ bars, className }: { bars: number | null | undefined; className?: string }) {
  if (bars === null || bars === undefined) return <span className={cn("text-xs text-text-secondary", className)}>—</span>;
  const filled = Math.max(0, Math.min(BARS, Math.round(bars)));
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Bars filled={filled} tone={toneOf(filled, 1)} label={`Signal ${filled} of ${BARS} bars`} />
      <span className="text-xs tabular-nums text-text-secondary">{filled}/{BARS}</span>
    </span>
  );
}
