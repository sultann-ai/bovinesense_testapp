"use client";

import { ArrowRight, Battery, CheckCircle, MapPin, ShieldAlert, Truck, UserPlus, WifiOff, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Timestamp } from "./timestamp";

/**
 * Alert feed item (DESIGN.md §7/§8): a card with a 4 px severity bar on the left, an unread dot while
 * the alert is new, a title in plain words, the tag / borrower / loan line in mono, the branch and the
 * fact that matters, and the actions View on map, Acknowledge, Open.
 */
export interface FeedAlert {
  id: number;
  type: string;
  status: string;
  title: string;
  detail: string | null;
  created_at: string;
  animal_id: number;
  tag_serial: string | null;
  borrower_name: string | null;
  loan_number: string | null;
  branch_name: string;
}

const BY_TYPE: Record<string, { bar: string; icon: LucideIcon }> = {
  breach: { bar: "bg-status-breach", icon: ShieldAlert },
  near_boundary: { bar: "bg-status-near", icon: ShieldAlert },
  fast_movement: { bar: "bg-status-fast", icon: Truck },
  tag_offline: { bar: "bg-status-stale", icon: WifiOff },
  low_battery: { bar: "bg-status-info", icon: Battery },
  returned: { bar: "bg-status-info", icon: CheckCircle },
};

interface Props {
  alert: FeedAlert;
  selected: boolean;
  /** Whether the user may acknowledge (their role is checked by the caller). */
  canAcknowledge: boolean;
  onOpen: (animalId: number) => void;
  onAcknowledge: (alertId: number) => void;
  onLocate: (animalId: number) => void;
  /** Assign / Resolve are shown only when the handler is given (the caller checks the role). */
  onAssign?: (alertId: number) => void;
  onResolve?: (alertId: number) => void;
}

export function AlertFeedItem({ alert, selected, canAcknowledge, onOpen, onAcknowledge, onLocate, onAssign, onResolve }: Props) {
  const look = BY_TYPE[alert.type] ?? BY_TYPE.returned;
  const isNew = alert.status === "new";
  const Icon = look.icon;

  return (
    <article
      data-testid="alert-feed-item"
      data-selected={selected}
      className={cn("relative flex border-b border-border transition-colors", selected ? "bg-brand-tint" : "bg-bg-surface hover:bg-bg-sunken")}
    >
      <div aria-hidden className={cn("w-1 shrink-0", look.bar)} />
      {isNew && <span data-testid="unread-dot" aria-label="Unread" className={cn("absolute right-3 top-3 h-2 w-2 rounded-full", look.bar)} />}

      <div className="min-w-0 flex-1 p-3">
        <button type="button" onClick={() => onOpen(alert.animal_id)} className="block w-full text-left outline-none focus-visible:underline">
          <div className="flex items-start justify-between gap-2">
            <span className="flex items-center gap-1.5 pr-4 text-sm font-semibold leading-5 text-text-primary">
              <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-text-secondary" />
              {alert.title}
            </span>
            <Timestamp value={alert.created_at} className="shrink-0" />
          </div>
          <div className="font-mono-ids mt-0.5 truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">
            {alert.tag_serial ?? "—"} · {alert.borrower_name ?? "—"} · {alert.loan_number ?? "—"}
          </div>
          <div className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">
            {alert.branch_name}
            {alert.detail && ` · ${alert.detail}`}
          </div>
        </button>

        <div className="mt-2 flex items-center gap-1">
          <Button variant="ghost" className="h-7 px-2 text-xs text-brand-hover" onClick={() => onLocate(alert.animal_id)}>
            <MapPin size={12} strokeWidth={1.5} aria-hidden /> View on map
          </Button>
          {isNew && canAcknowledge && (
            <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => onAcknowledge(alert.id)}>
              <CheckCircle size={12} strokeWidth={1.5} aria-hidden /> Acknowledge
            </Button>
          )}
          {onAssign && alert.status !== "assigned" && alert.status !== "resolved" && (
            <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => onAssign(alert.id)}>
              <UserPlus size={12} strokeWidth={1.5} aria-hidden /> Assign
            </Button>
          )}
          {onResolve && alert.status !== "resolved" && (
            <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => onResolve(alert.id)}>
              <CheckCircle size={12} strokeWidth={1.5} aria-hidden /> Resolve
            </Button>
          )}
          <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => onOpen(alert.animal_id)}>
            <ArrowRight size={12} strokeWidth={1.5} aria-hidden /> Open
          </Button>
        </div>
      </div>
    </article>
  );
}
