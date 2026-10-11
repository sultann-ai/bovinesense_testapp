"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { StatusPill } from "./status-pill";

/**
 * Animal drawer frame (DESIGN.md §8): on the right, 420 px wide, 14 px radius on the left edge. Header:
 * tag ID (mono), status pill, close. Then a mini map, then the tabs Location, Borrower and loan,
 * Tag health, Events. This is only the frame: the caller supplies the data and the tab panels.
 */
export const DRAWER_TABS = [
  { key: "location", label: "Location" },
  { key: "borrower", label: "Borrower and loan" },
  { key: "tag", label: "Tag health" },
  { key: "events", label: "Events" },
] as const;
export type DrawerTab = (typeof DRAWER_TABS)[number]["key"];

interface Props {
  open: boolean;
  /** Tag ID shown in the header; null while loading. */
  tagSerial: string | null;
  status: string | null;
  onClose: () => void;
  /** The mini map (or a placeholder when the animal has no position). */
  miniMap: ReactNode;
  tab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  children: ReactNode;
}

export function AnimalDrawerFrame({ open, tagSerial, status, onClose, miniMap, tab, onTabChange, children }: Props) {
  return (
    <>
      {open && <div aria-hidden className="absolute inset-0 z-20 bg-text-primary/10" onClick={onClose} />}
      <aside
        aria-label="Animal details"
        aria-hidden={!open}
        data-testid="animal-drawer"
        data-open={open}
        className={cn(
          "absolute bottom-0 right-0 top-0 z-30 flex w-[420px] flex-col rounded-l-[var(--radius-lg)] border-l border-border bg-bg-surface shadow-[var(--shadow-float)]",
          "transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono-ids truncate text-sm text-text-primary">{tagSerial ?? "Loading…"}</span>
            {status && <StatusPill status={status} />}
          </div>
          <Button variant="ghost" size="icon" aria-label="Close details" onClick={onClose}>
            <X size={20} strokeWidth={1.5} />
          </Button>
        </header>

        <div className="relative flex h-40 shrink-0 items-center justify-center bg-bg-sunken">{miniMap}</div>

        <div role="tablist" aria-label="Animal details" className="flex shrink-0 border-b border-border">
          {DRAWER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => onTabChange(t.key)}
              className={cn(
                "flex-1 border-b-2 py-2.5 text-xs font-medium outline-none transition-colors focus-visible:bg-bg-sunken",
                tab === t.key ? "border-brand text-brand-hover" : "border-transparent text-text-secondary hover:text-text-primary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="flex-1 overflow-y-auto p-5">
          {children}
        </div>
      </aside>
    </>
  );
}
