"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  NO_SCOPE, branchesFor, parseStoredScope, reconcileScope, scopeKey, withScope,
  type Branch, type Region, type ScopeLists, type ScopeSelection,
} from "@/lib/scope";

/**
 * The region / branch the whole app is narrowed to (the top-bar scope selector). Screens read
 * `selection` (or `scoped(path)`) and refetch when `key` changes.
 *
 * The lists come from /api/scope (tenant data, filtered by Row Level Security). The choice is kept
 * per organization in localStorage, so it survives a reload but never leaks into another tenant.
 * It narrows what is shown; it does not grant anything.
 */
type LoadStatus = "loading" | "ready" | "error";

interface ScopeValue {
  status: LoadStatus;
  regions: readonly Region[];
  /** Branches of the chosen region (all branches when none is chosen). */
  branches: readonly Branch[];
  locked: ScopeSelection;
  selection: ScopeSelection;
  /** Changes whenever the selection does: use as an effect dependency. */
  key: string;
  setRegion: (regionId: number | null) => void;
  setBranch: (branchId: number | null) => void;
  /** `path` with the scope added as query parameters. */
  scoped: (path: string) => string;
  retry: () => void;
}

const ScopeContext = createContext<ScopeValue>({
  status: "loading",
  regions: [],
  branches: [],
  locked: NO_SCOPE,
  selection: NO_SCOPE,
  key: scopeKey(NO_SCOPE),
  setRegion: () => {},
  setBranch: () => {},
  scoped: (p) => p,
  retry: () => {},
});

export function useScope(): ScopeValue {
  return useContext(ScopeContext);
}

const storageKey = (organizationId: string) => `bs:scope:${organizationId}`;

function readStored(organizationId: string): ScopeSelection {
  try {
    return parseStoredScope(window.localStorage.getItem(storageKey(organizationId)));
  } catch {
    return NO_SCOPE;
  }
}

function writeStored(organizationId: string, selection: ScopeSelection): void {
  try {
    window.localStorage.setItem(storageKey(organizationId), JSON.stringify(selection));
  } catch {
    /* private window: the choice just does not persist */
  }
}

export function ScopeProvider({ organizationId, children }: { organizationId: string; children: React.ReactNode }) {
  const [lists, setLists] = useState<ScopeLists | null>(null);
  const [selection, setSelection] = useState<ScopeSelection>(NO_SCOPE);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/scope", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as ScopeLists;
        if (cancelled) return;
        const loaded: ScopeLists = { regions: body.regions ?? [], branches: body.branches ?? [], locked: body.locked ?? NO_SCOPE };
        setLists(loaded);
        setSelection(reconcileScope(readStored(organizationId), loaded));
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, attempt]);

  const choose = useCallback(
    (next: ScopeSelection) => {
      const clean = lists ? reconcileScope(next, lists) : next;
      setSelection(clean);
      writeStored(organizationId, clean);
    },
    [lists, organizationId],
  );

  const setRegion = useCallback((regionId: number | null) => choose({ regionId, branchId: null }), [choose]);
  const setBranch = useCallback((branchId: number | null) => choose({ regionId: selection.regionId, branchId }), [choose, selection.regionId]);
  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((a) => a + 1);
  }, []);

  const value = useMemo<ScopeValue>(
    () => ({
      status,
      regions: lists?.regions ?? [],
      branches: lists ? branchesFor(selection.regionId, lists.branches) : [],
      locked: lists?.locked ?? NO_SCOPE,
      selection,
      key: scopeKey(selection),
      setRegion,
      setBranch,
      scoped: (path: string) => withScope(path, selection),
      retry,
    }),
    [status, lists, selection, setRegion, setBranch, retry],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}
