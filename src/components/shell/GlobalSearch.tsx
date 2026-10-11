"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";

/**
 * Global search (top bar): one box for a tag ID, a loan ID or a borrower's name. Picking a result
 * opens the Overview on that animal (the map flies to it and the drawer opens). It says so when
 * nothing matches and when the search itself fails, with a retry.
 */
interface SearchResult {
  animal_id: number;
  animal_name: string | null;
  status: string;
  tag_serial: string | null;
  borrower_name: string | null;
  loan_number: string | null;
  branch_name: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; rows: SearchResult[] }
  | { kind: "error" };

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const term = q.trim();
  useEffect(() => {
    if (term.length < MIN_CHARS) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState({ kind: "loading" });
      setOpen(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const rows = await res.json();
        if (cancelled) return;
        setState({ kind: "results", rows: Array.isArray(rows) ? rows : [] });
        setActive(0);
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, attempt]);

  const showing = open && term.length >= MIN_CHARS;
  const rows = state.kind === "results" ? state.rows : [];

  function pick(r: SearchResult) {
    setQ("");
    setOpen(false);
    setState({ kind: "idle" });
    router.push(`/?animal=${r.animal_id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!showing || rows.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % rows.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + rows.length) % rows.length); }
    if (e.key === "Enter") { e.preventDefault(); pick(rows[active]); }
  }

  return (
    <div ref={wrapper} className="relative min-w-[280px] max-w-md flex-1">
      <Search size={16} strokeWidth={1.5} aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
      <input
        type="search"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-label="Search by tag ID, loan ID or borrower"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search tag, loan or borrower"
        className={cn(
          "h-9 w-full rounded-[var(--radius-sm)] border border-border bg-bg-sunken pl-9 pr-3 text-sm text-text-primary placeholder:text-text-secondary",
          "outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand/30",
        )}
      />

      {showing && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-bg-surface shadow-[var(--shadow-float)]"
        >
          {state.kind === "loading" && <p className="px-3 py-3 text-sm text-text-secondary">Searching…</p>}

          {state.kind === "error" && (
            <div role="alert" className="flex items-center justify-between gap-2 px-3 py-3">
              <p className="text-sm text-text-primary">The search failed.</p>
              <Button variant="secondary" className="h-7 px-3 text-xs" onClick={() => setAttempt((a) => a + 1)}>Try again</Button>
            </div>
          )}

          {state.kind === "results" && rows.length === 0 && (
            <p className="px-3 py-3 text-sm text-text-secondary">No animal, loan or borrower matches “{term}”.</p>
          )}

          {rows.map((r, i) => (
            <button
              key={r.animal_id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={() => pick(r)}
              className={cn("flex w-full items-center gap-3 px-3 py-2 text-left transition-colors", i === active ? "bg-bg-sunken" : "hover:bg-bg-sunken")}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {r.tag_serial && <span className="font-mono-ids text-[0.8125rem] text-text-primary">{r.tag_serial}</span>}
                  {r.borrower_name && <span className="truncate text-[0.8125rem] text-text-primary">{r.borrower_name}</span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-text-secondary">
                  {r.loan_number && <span className="font-mono-ids">{r.loan_number}</span>}
                  <span className="truncate">{r.branch_name}</span>
                </div>
              </div>
              <StatusPill status={r.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
