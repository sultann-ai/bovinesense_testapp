"use client";

import { CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { AlertFeedItem, type FeedAlert } from "@/components/ui/alert-feed-item";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { usePermissions } from "@/components/shell/PermissionsProvider";

export interface AlertRow extends FeedAlert {
  severity:    string;
  distance_km: number | null;
  animal_name: string | null;
}

interface Props {
  alerts:          AlertRow[];
  loading:         boolean;
  /** Set when the feed could not be loaded. */
  failed?:         boolean;
  onRetry?:        () => void;
  /** How many alerts the panel lists (after the "Unacknowledged only" toggle). */
  total:           number;
  /** Show only alerts nobody has acknowledged yet. */
  unackOnly:       boolean;
  onUnackOnlyChange: (on: boolean) => void;
  selectedId:      number | null;
  onSelectAnimal:  (id: number) => void;
  onAcknowledge:   (id: number) => void;
  onFlyTo:         (animalId: number) => void;
  onAssign:        (alertId: number) => void;
  onResolve:       (alertId: number) => void;
}

/** The live alert panel (360 px): the newest open alerts, as feed items. */
export function AlertFeed({ alerts, loading, failed = false, onRetry, total, unackOnly, onUnackOnlyChange, selectedId, onSelectAnimal, onAcknowledge, onFlyTo, onAssign, onResolve }: Props) {
  const { can } = usePermissions();
  const canAcknowledge = can("alerts:acknowledge");
  const canAssign = can("alerts:assign");
  const canResolve = can("alerts:resolve");

  return (
    <section aria-label="Live alerts" className="flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-border bg-bg-surface">
      <header className="z-10 flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Live alerts</h2>
          <span
            data-testid="alert-count"
            aria-label={`${total} ${total === 1 ? "alert" : "alerts"} listed`}
            className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums", total > 0 ? "bg-status-breach text-white" : "bg-bg-sunken text-text-secondary")}
          >
            {total}
          </span>
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-text-secondary">
          Unacknowledged only
          <button
            type="button"
            role="switch"
            aria-checked={unackOnly}
            onClick={() => onUnackOnlyChange(!unackOnly)}
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40",
              unackOnly ? "border-brand bg-brand" : "border-border bg-bg-sunken",
            )}
          >
            <span aria-hidden className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-bg-surface shadow-sm transition-[left]", unackOnly ? "left-[18px]" : "left-0.5")} />
          </button>
        </label>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div role="status" aria-label="Loading alerts" className="flex flex-col">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2 border-b border-border p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        )}

        {!loading && failed && <ErrorState what="The alerts could not be loaded." onRetry={onRetry ?? (() => {})} />}

        {!loading && !failed && alerts.length === 0 && (
          <EmptyState
            icon={<CheckCircle size={20} strokeWidth={1.5} className="text-status-inside-text" />}
            title={unackOnly ? "Nothing unacknowledged in this view." : "No open alerts in this view."}
            action={{ label: "See all alerts", href: "/alerts" }}
          />
        )}

        {!loading && !failed && alerts.map((alert) => (
          <AlertFeedItem
            key={alert.id}
            alert={alert}
            selected={selectedId === alert.animal_id}
            canAcknowledge={canAcknowledge}
            onOpen={onSelectAnimal}
            onAcknowledge={onAcknowledge}
            onLocate={onFlyTo}
            onAssign={canAssign ? onAssign : undefined}
            onResolve={canResolve ? onResolve : undefined}
          />
        ))}
      </div>
    </section>
  );
}
