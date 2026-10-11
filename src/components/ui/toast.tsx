"use client";

import { useEffect } from "react";
import { Info, ShieldAlert, Truck, WifiOff, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Toast (DESIGN.md §8): top right, 360 px wide, gone after 8 s, a left colour bar by severity and one
 * action ("View"). The icon and the title carry the meaning; the bar is only reinforcement.
 */
export const TOAST_DURATION_MS = 8000;

export interface ToastItem {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  animalId: number;
  detail?: string;
}

const BY_SEVERITY: Record<string, { bar: string; icon: LucideIcon; tint: string }> = {
  critical: { bar: "bg-status-breach", icon: ShieldAlert, tint: "bg-status-breach-tint text-status-breach" },
  warning: { bar: "bg-status-near", icon: WifiOff, tint: "bg-status-near-tint text-status-near-text" },
  info: { bar: "bg-status-info", icon: Info, tint: "bg-status-info-tint text-status-info" },
};

const BY_TYPE: Record<string, LucideIcon> = {
  breach: ShieldAlert,
  fast_movement: Truck,
  tag_offline: WifiOff,
};

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onView: (animalId: number) => void;
}

export function Toast({ toast, onDismiss, onView }: ToastProps) {
  const look = BY_SEVERITY[toast.severity] ?? BY_SEVERITY.info;
  const Icon = BY_TYPE[toast.alertType] ?? look.icon;

  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div role="alert" data-testid="toast" className="relative flex w-[360px] overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-surface shadow-[var(--shadow-float)]">
      <div aria-hidden className={cn("w-1 shrink-0", look.bar)} />
      <div className="flex flex-1 items-start gap-3 p-3">
        <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", look.tint)}>
          <Icon size={16} strokeWidth={1.5} aria-hidden />
        </span>
        <div className="min-w-0 flex-1 pr-4">
          <p className="text-sm font-semibold leading-5 text-text-primary">{toast.title}</p>
          {toast.detail && <p className="mt-0.5 truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">{toast.detail}</p>}
          <Button variant="ghost" className="-ml-2 mt-1 h-7 px-2 text-xs text-brand-hover" onClick={() => onView(toast.animalId)}>
            View
          </Button>
        </div>
      </div>
      <Button variant="ghost" size="icon" aria-label="Dismiss" className="absolute right-1 top-1 h-7 w-7" onClick={() => onDismiss(toast.id)}>
        <X size={14} strokeWidth={1.5} />
      </Button>
    </div>
  );
}

interface StackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onView: (animalId: number) => void;
}

export function ToastStack({ toasts, onDismiss, onView }: StackProps) {
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={onDismiss} onView={onView} />
        </div>
      ))}
    </div>
  );
}
