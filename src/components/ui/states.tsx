import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Loading, empty and error states (DESIGN.md §8), used by every screen.
 *
 *   Skeleton     a cream block. It does not shimmer: the product has exactly one looping animation
 *                (the pulse on an unacknowledged breach), so loading is shown by shape, not motion.
 *   EmptyState   one sentence and one action.
 *   ErrorState   says what failed and offers a retry.
 */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("rounded-[var(--radius-sm)] bg-bg-sunken", className)} style={style} />;
}

/** A column of skeleton lines, for panels and drawers. */
export function SkeletonLines({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${55 + ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

interface EmptyProps {
  /** One sentence saying what is missing. */
  title: string;
  /** The single thing to do about it. */
  action?: { label: string; onClick: () => void } | { label: string; href: string };
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, action, icon, className }: EmptyProps) {
  return (
    <div role="status" data-testid="empty-state" className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-bg-sunken text-text-secondary">
        {icon ?? <Inbox size={20} strokeWidth={1.5} />}
      </span>
      <p className="max-w-sm text-sm text-text-secondary">{title}</p>
      {action && "href" in action && (
        <a href={action.href} className="text-sm font-medium text-brand-hover underline-offset-2 hover:underline">
          {action.label}
        </a>
      )}
      {action && "onClick" in action && (
        <Button variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

interface ErrorProps {
  /** What failed, in plain words ("The alerts could not be loaded."). */
  what: string;
  onRetry: () => void;
  /** A single line with the retry beside it, for strips and panels. */
  compact?: boolean;
  className?: string;
}

export function ErrorState({ what, onRetry, compact = false, className }: ErrorProps) {
  if (compact) {
    return (
      <div role="alert" data-testid="error-state" className={cn("flex items-center gap-3 px-4 py-2", className)}>
        <AlertTriangle size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-status-breach" />
        <p className="flex-1 text-sm text-text-primary">{what}</p>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div role="alert" data-testid="error-state" className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-status-breach-tint text-status-breach">
        <AlertTriangle size={20} strokeWidth={1.5} />
      </span>
      <p className="max-w-sm text-sm text-text-primary">{what}</p>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
