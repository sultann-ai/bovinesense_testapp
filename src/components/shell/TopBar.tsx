"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Bell, ChevronDown, CheckCircle, ShieldAlert, AlertTriangle, Truck, WifiOff } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnimalStatus = "inside" | "near" | "breach" | "fast" | "stale";

interface SearchResult {
  animal_id: number;
  animal_name: string | null;
  status: AnimalStatus;
  tag_serial: string | null;
  borrower_name: string | null;
  loan_number: string | null;
  branch_name: string;
  lat: number | null;
  lon: number | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const ROLES = [
  { value: "hq_admin",          label: "HQ Admin" },
  { value: "regional_manager",  label: "Regional Manager" },
  { value: "branch_officer",    label: "Branch Officer" },
  { value: "auditor",           label: "Auditor" },
] as const;

const REGIONS  = ["All Regions",  "Lahore", "Rawalpindi", "Faisalabad", "Multan", "Gujranwala"];
const BRANCHES = ["All Branches", "Main Branch", "Gulberg", "DHA", "Cantt"];

const STATUS_ICONS: Record<AnimalStatus, React.ElementType> = {
  inside: CheckCircle,
  near:   AlertTriangle,
  breach: ShieldAlert,
  fast:   Truck,
  stale:  WifiOff,
};

const STATUS_COLOR: Record<AnimalStatus, string> = {
  inside: "var(--status-inside)",
  near:   "var(--status-near)",
  breach: "var(--status-breach)",
  fast:   "var(--status-fast)",
  stale:  "var(--status-stale)",
};

// ─── Search dropdown ──────────────────────────────────────────────────────────

function GlobalSearch() {
  const router = useRouter();
  const [q,        setQ]        = useState("");
  const [results,  setResults]  = useState<SearchResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [open,     setOpen]     = useState(false);
  const debRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Debounce search
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    debRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
        setResults(Array.isArray(rows) ? rows : []);
        setOpen(rows?.length > 0);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [q]);

  function select(result: SearchResult) {
    setQ("");
    setResults([]);
    setOpen(false);
    // Navigate to overview with animal param to fly-to + open drawer
    router.push(`/?animal=${result.animal_id}`);
  }

  return (
    <div ref={wrapperRef} className="relative flex-1 max-w-sm">
      {loading ? (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 border-transparent animate-spin"
          style={{ borderTopColor: "var(--text-secondary)" }} />
      ) : (
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
      )}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        placeholder="Search tag ID, loan ID, borrower…"
        className={cn(
          "w-full rounded-[var(--radius-sm)] border border-border bg-bg-sunken",
          "pl-9 pr-3 py-[7px] text-sm text-text-primary placeholder:text-text-secondary",
          "outline-none focus:border-brand focus:ring-1 focus:ring-brand/30 transition-colors",
        )}
      />

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 overflow-hidden rounded-[var(--radius-md)] border shadow-[var(--shadow-float)]"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)" }}
        >
          {results.map((r) => {
            const Icon = STATUS_ICONS[r.status];
            return (
              <button
                key={r.animal_id}
                onMouseDown={() => select(r)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-sunken"
              >
                <Icon size={14} strokeWidth={1.5} style={{ color: STATUS_COLOR[r.status], flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {r.tag_serial && (
                      <span className="font-mono-ids text-xs text-text-primary">{r.tag_serial}</span>
                    )}
                    {r.borrower_name && (
                      <span className="text-xs text-text-primary truncate">{r.borrower_name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {r.loan_number && (
                      <span className="font-mono-ids text-[10px] text-text-secondary">{r.loan_number}</span>
                    )}
                    <span className="text-[10px] text-text-secondary">{r.branch_name}</span>
                  </div>
                </div>
                <span
                  className="text-[10px] font-medium capitalize shrink-0"
                  style={{ color: STATUS_COLOR[r.status] }}
                >
                  {r.status}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

export function TopBar() {
  const [role,       setRole]       = useState<string>("hq_admin");
  const [alertCount]                = useState(3);

  const currentRole = ROLES.find((r) => r.value === role);

  return (
    <header className="flex h-16 items-center gap-4 border-b border-border bg-bg-surface px-6 shrink-0 z-20">
      {/* Brand */}
      <div className="flex items-center gap-2 text-sm shrink-0">
        <span className="font-semibold text-text-primary">Bank of Punjab</span>
        <span className="text-text-secondary">·</span>
        <span className="text-text-secondary text-xs">Powered by Bovine</span>
      </div>

      <div className="h-5 w-px bg-border mx-1" />

      {/* Global search */}
      <GlobalSearch />

      {/* Region / Branch selector */}
      <div className="flex items-center gap-2 shrink-0">
        <RegionSelect />
        <BranchSelect />
      </div>

      <div className="flex-1" />

      {/* Alert bell */}
      <button
        className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-text-secondary hover:bg-bg-sunken hover:text-text-primary transition-colors"
        aria-label={`${alertCount} unread alerts`}
      >
        <Bell size={20} strokeWidth={1.5} />
        {alertCount > 0 && (
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-status-breach" />
        )}
      </button>

      {/* User menu */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={cn(
            "flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5",
            "border border-border bg-bg-surface text-sm text-text-primary",
            "hover:bg-bg-sunken transition-colors outline-none focus:ring-1 focus:ring-brand/30",
          )}>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-white text-xs font-semibold">
              M
            </div>
            <span className="font-medium">{currentRole?.label}</span>
            <ChevronDown size={14} className="text-text-secondary" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={cn(
              "z-50 min-w-[200px] rounded-[var(--radius-md)] border border-border bg-bg-surface",
              "shadow-[var(--shadow-float)] p-1",
              "animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2",
            )}
            sideOffset={6}
            align="end"
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-secondary">
              Switch Role
            </div>
            {ROLES.map((r) => (
              <DropdownMenu.Item
                key={r.value}
                onSelect={() => setRole(r.value)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-sm outline-none",
                  "text-text-primary hover:bg-bg-sunken transition-colors",
                  role === r.value && "bg-brand-tint text-brand font-medium",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", role === r.value ? "bg-brand" : "")} />
                {r.label}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item className="flex cursor-pointer items-center rounded-[var(--radius-sm)] px-2 py-2 text-sm text-text-secondary hover:bg-bg-sunken hover:text-text-primary outline-none transition-colors">
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </header>
  );
}

function RegionSelect() {
  return (
    <Select.Root defaultValue="All Regions">
      <Select.Trigger className={cn(
        "flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-3",
        "text-sm text-text-primary outline-none hover:bg-bg-sunken transition-colors focus:ring-1 focus:ring-brand/30",
      )}>
        <Select.Value />
        <Select.Icon><ChevronDown size={12} className="text-text-secondary" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="z-50 overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-surface shadow-[var(--shadow-float)]">
          <Select.Viewport className="p-1">
            {REGIONS.map((r) => (
              <Select.Item key={r} value={r} className="flex cursor-pointer items-center rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-text-primary outline-none hover:bg-bg-sunken transition-colors">
                <Select.ItemText>{r}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

function BranchSelect() {
  return (
    <Select.Root defaultValue="All Branches">
      <Select.Trigger className={cn(
        "flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-3",
        "text-sm text-text-primary outline-none hover:bg-bg-sunken transition-colors focus:ring-1 focus:ring-brand/30",
      )}>
        <Select.Value />
        <Select.Icon><ChevronDown size={12} className="text-text-secondary" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="z-50 overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-surface shadow-[var(--shadow-float)]">
          <Select.Viewport className="p-1">
            {BRANCHES.map((b) => (
              <Select.Item key={b} value={b} className="flex cursor-pointer items-center rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-text-primary outline-none hover:bg-bg-sunken transition-colors">
                <Select.ItemText>{b}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
