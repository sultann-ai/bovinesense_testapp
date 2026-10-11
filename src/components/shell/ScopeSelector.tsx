"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useScope } from "./ScopeProvider";

/**
 * Region and branch selector (top bar). It scopes the whole app: every list, the map, the KPIs and
 * the bell follow the choice. The names are the tenant's own (loaded from the database). A user whose
 * membership fixes a region or branch sees it, locked.
 */
const ALL = "all";

function Picker({
  label, value, onChange, options, allLabel, disabled,
}: {
  label: string;
  value: number | null;
  onChange: (id: number | null) => void;
  options: ReadonlyArray<{ id: number; name: string }>;
  allLabel: string;
  disabled: boolean;
}) {
  return (
    <Select.Root value={value === null ? ALL : String(value)} onValueChange={(v) => onChange(v === ALL ? null : Number(v))} disabled={disabled}>
      <Select.Trigger
        aria-label={label}
        data-testid={`scope-${label.toLowerCase()}`}
        className={cn(
          "flex h-9 max-w-[180px] items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-3 text-sm text-text-primary outline-none transition-colors",
          "hover:bg-bg-sunken focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-bg-surface",
        )}
      >
        <span className="truncate"><Select.Value /></span>
        <Select.Icon><ChevronDown size={14} strokeWidth={1.5} className="text-text-secondary" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content position="popper" sideOffset={6} className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-surface shadow-[var(--shadow-float)]">
          <Select.Viewport className="p-1">
            {[{ id: ALL, name: allLabel }, ...options].map((o) => (
              <Select.Item
                key={o.id}
                value={String(o.id)}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-sunken"
              >
                <Select.ItemText>{o.name}</Select.ItemText>
                <Select.ItemIndicator><Check size={14} strokeWidth={1.5} className="text-brand-hover" /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function ScopeSelector() {
  const scope = useScope();

  if (scope.status === "error") {
    return (
      <div className="flex shrink-0 items-center gap-2" role="alert">
        <span className="text-xs text-text-secondary">Regions unavailable</span>
        <Button variant="ghost" className="h-7 px-2 text-xs" onClick={scope.retry}>Retry</Button>
      </div>
    );
  }

  const loading = scope.status === "loading";
  const regionLocked = scope.locked.regionId !== null || scope.locked.branchId !== null;
  const branchLocked = scope.locked.branchId !== null;

  return (
    <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Scope" aria-busy={loading || undefined}>
      <Picker
        label="Region"
        value={scope.selection.regionId}
        onChange={scope.setRegion}
        options={scope.regions}
        allLabel="All regions"
        disabled={loading || regionLocked}
      />
      <Picker
        label="Branch"
        value={scope.selection.branchId}
        onChange={scope.setBranch}
        options={scope.branches}
        allLabel="All branches"
        disabled={loading || branchLocked}
      />
    </div>
  );
}
