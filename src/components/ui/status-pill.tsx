import { AlertTriangle, CheckCircle, Info, ShieldAlert, Truck, WifiOff, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, type AnimalStatus } from "@/lib/maps/status";

/**
 * Status pill (DESIGN.md §8): fully round, tint background, solid-colour text, a 14 px icon, 12/500.
 * Always an icon AND a word, never colour alone.
 */
export type PillTone = AnimalStatus | "info" | "brand";

const TONES: Record<PillTone, { icon: LucideIcon; classes: string }> = {
  inside: { icon: CheckCircle, classes: "bg-status-inside-tint text-status-inside-text" },
  near: { icon: AlertTriangle, classes: "bg-status-near-tint text-status-near-text" },
  breach: { icon: ShieldAlert, classes: "bg-status-breach-tint text-status-breach" },
  fast: { icon: Truck, classes: "bg-status-fast-tint text-status-fast" },
  stale: { icon: WifiOff, classes: "bg-status-stale-tint text-status-stale-text" },
  info: { icon: Info, classes: "bg-status-info-tint text-status-info" },
  brand: { icon: Info, classes: "bg-brand-tint text-brand-hover" },
};

interface PillProps {
  tone: PillTone;
  label: string;
  icon?: LucideIcon;
  className?: string;
}

/** Any labelled pill (alert types, alert states). */
export function Pill({ tone, label, icon, className }: PillProps) {
  const t = TONES[tone];
  const Icon = icon ?? t.icon;
  return (
    <span
      data-tone={tone}
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", t.classes, className)}
    >
      <Icon size={14} strokeWidth={1.5} aria-hidden />
      {label}
    </span>
  );
}

const KNOWN: ReadonlySet<string> = new Set(["inside", "near", "breach", "fast", "stale"]);

/** An animal's status. Anything unknown reads as offline: when in doubt, never look healthy. */
export function StatusPill({ status, className }: { status: string; className?: string }) {
  const tone: AnimalStatus = KNOWN.has(status) ? (status as AnimalStatus) : "stale";
  return <Pill tone={tone} label={STATUS_LABELS[tone]} className={className} />;
}
