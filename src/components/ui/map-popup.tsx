"use client";

import { X } from "lucide-react";
import { Button } from "./button";
import { StatusPill } from "./status-pill";
import { Timestamp } from "./timestamp";

/**
 * Map popup (DESIGN.md §8): a 280 px card shown when a marker is clicked: tag ID, borrower, last fix,
 * status and an "Open details" action.
 */
export interface MapPopupData {
  tagSerial: string | null;
  animalName: string | null;
  borrowerName: string | null;
  lastFixAt: string | null;
  status: string;
}

interface Props {
  animal: MapPopupData;
  /** Past this many hours the last fix is shown as stale. */
  staleAfterHours: number;
  onOpenDetails: () => void;
  onClose: () => void;
}

export function MapPopup({ animal, staleAfterHours, onOpenDetails, onClose }: Props) {
  return (
    <div
      role="dialog"
      aria-label={`Animal ${animal.tagSerial ?? animal.animalName ?? ""}`.trim()}
      data-testid="map-popup"
      className="w-[280px] rounded-[var(--radius-md)] border border-border bg-bg-surface p-4 shadow-[var(--shadow-float)]"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono-ids truncate text-[0.8125rem] leading-[1.125rem] text-text-primary">{animal.tagSerial ?? "No tag"}</span>
        <Button variant="ghost" size="icon" aria-label="Close" className="-mr-2 -mt-2 h-7 w-7" onClick={onClose}>
          <X size={14} strokeWidth={1.5} />
        </Button>
      </div>
      <p className="mt-1 truncate text-sm font-medium text-text-primary">{animal.borrowerName ?? animal.animalName ?? "Unassigned"}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <StatusPill status={animal.status} />
        <span className="flex items-center gap-1 text-xs text-text-secondary">
          Last fix <Timestamp value={animal.lastFixAt} staleAfterHours={staleAfterHours} empty="none" />
        </span>
      </div>
      <Button className="mt-3 w-full" onClick={onOpenDetails}>
        Open details
      </Button>
    </div>
  );
}
