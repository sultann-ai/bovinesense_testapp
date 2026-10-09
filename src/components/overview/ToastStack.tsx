"use client";

import { useEffect } from "react";
import { X, ShieldAlert, Truck, WifiOff, Info } from "lucide-react";

export interface ToastItem {
  id:         string;
  alertType:  string;
  severity:   string;
  title:      string;
  animalId:   number;
  detail?:    string;
}

interface Props {
  toasts:    ToastItem[];
  onDismiss: (id: string) => void;
  onView:    (animalId: number) => void;
}

const SEVERITY_STYLES: Record<string, { bar: string; icon: typeof ShieldAlert }> = {
  critical: { bar: "var(--status-breach)",  icon: ShieldAlert },
  warning:  { bar: "var(--status-near)",    icon: WifiOff },
  info:     { bar: "var(--status-info)",    icon: Info },
};

const TYPE_ICON: Record<string, typeof ShieldAlert> = {
  breach:        ShieldAlert,
  fast_movement: Truck,
  tag_offline:   WifiOff,
};

function Toast({ toast, onDismiss, onView }: {
  toast:     ToastItem;
  onDismiss: (id: string) => void;
  onView:    (animalId: number) => void;
}) {
  const sev = SEVERITY_STYLES[toast.severity] ?? SEVERITY_STYLES.info;
  const Icon = TYPE_ICON[toast.alertType] ?? sev.icon;

  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 8000);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div
      className="relative flex w-[360px] overflow-hidden rounded-[10px] bg-bg-surface shadow-float"
      style={{ boxShadow: "var(--shadow-float)" }}
      role="alert"
    >
      {/* Left severity bar */}
      <div className="w-1 shrink-0" style={{ backgroundColor: sev.bar }} />

      <div className="flex flex-1 items-start gap-3 p-3">
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: sev.bar + "22" }}
        >
          <Icon size={16} strokeWidth={1.5} style={{ color: sev.bar }} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-text-primary leading-tight">{toast.title}</p>
          {toast.detail && (
            <p className="mt-0.5 text-xs text-text-secondary truncate">{toast.detail}</p>
          )}
          <button
            onClick={() => onView(toast.animalId)}
            className="mt-1.5 text-[11px] font-medium transition-colors"
            style={{ color: "var(--brand)" }}
          >
            View →
          </button>
        </div>
      </div>

      <button
        onClick={() => onDismiss(toast.id)}
        className="absolute right-2 top-2 p-1 text-text-secondary hover:text-text-primary transition-colors"
        aria-label="Dismiss"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

export function ToastStack({ toasts, onDismiss, onView }: Props) {
  if (!toasts.length) return null;
  return (
    <div className="fixed right-4 top-20 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={onDismiss} onView={onView} />
        </div>
      ))}
    </div>
  );
}
