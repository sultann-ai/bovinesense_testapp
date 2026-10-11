"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/filter-bar";

interface AnimalOption {
  id: number;
  tag_serial: string | null;
  borrower_name: string | null;
  loan_number: string | null;
  geofence_id: number | null;
  geofence_name: string | null;
}

interface Props {
  fence: { id: number; name: string };
  onClose: () => void;
  /** Called after the assignment was saved. */
  onSaved: () => void;
}

async function post(fenceId: number, action: "assign" | "unassign", ids: number[]): Promise<string | null> {
  if (ids.length === 0) return null;
  try {
    const res = await fetch(`/api/geofences/${fenceId}/animals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ animal_ids: ids, action }),
    });
    if (res.ok) return null;
    const d = await res.json().catch(() => ({}));
    return typeof d.error === "string" ? d.error : "The assignment could not be saved.";
  } catch {
    return "The assignment could not be saved. Check your connection and try again.";
  }
}

/**
 * Pick the animals a fence watches. An animal has one active fence: ticking one that sits on another
 * fence moves it here (the row says which fence it leaves). Unticking one that is on this fence
 * takes it off, after which it has no fence and the rules cannot flag a breach for it.
 */
export function AssignAnimalsDialog({ fence, onClose, onSaved }: Props) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loaded, setLoaded] = useState<{ key: string; animals: AnimalOption[] | null } | null>(null);
  // Ticks the person changed from what the server says; the rest follow the server.
  const [changes, setChanges] = useState<Map<number, boolean>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: "200" });
    if (debouncedQ) params.set("q", debouncedQ);
    fetch(`/api/animals?${params}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((animals: AnimalOption[]) => { if (!cancelled) setLoaded({ key: debouncedQ, animals }); })
      .catch(() => { if (!cancelled) setLoaded({ key: debouncedQ, animals: null }); });
    return () => { cancelled = true; };
  }, [debouncedQ]);

  const mine = loaded?.key === debouncedQ ? loaded : null;
  const animals = mine?.animals ?? null;
  const isChecked = (a: AnimalOption) => changes.get(a.id) ?? a.geofence_id === fence.id;

  function toggle(a: AnimalOption) {
    setChanges((prev) => {
      const next = new Map(prev);
      const now = !isChecked(a);
      if (now === (a.geofence_id === fence.id)) next.delete(a.id); else next.set(a.id, now);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const toAssign = [...changes].filter(([, on]) => on).map(([id]) => id);
    const toRemove = [...changes].filter(([, on]) => !on).map(([id]) => id);
    const failure = (await post(fence.id, "assign", toAssign)) ?? (await post(fence.id, "unassign", toRemove));
    setBusy(false);
    if (failure) { setError(failure); return; }
    onSaved();
    onClose();
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-text-primary/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-[var(--radius-lg)] border border-border bg-bg-surface p-6 shadow-[var(--shadow-float)]">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold leading-[26px] text-text-primary">Assign animals to {fence.name}</Dialog.Title>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X size={20} strokeWidth={1.5} /></Button>
          </div>
          <Dialog.Description className="mb-3 text-sm text-text-secondary">
            Each animal has one active fence. Choosing an animal that is on another fence moves it here.
          </Dialog.Description>

          <SearchField value={q} onChange={setQ} placeholder="Tag ID, loan ID, borrower…" label="Search animals" />

          <div className="mt-3 min-h-[160px] flex-1 overflow-y-auto rounded-[var(--radius-sm)] border border-border">
            {mine === null && <p role="status" className="p-4 text-sm text-text-secondary">Loading animals…</p>}
            {mine !== null && animals === null && <p role="alert" className="p-4 text-sm text-status-breach">The animals could not be loaded.</p>}
            {animals !== null && animals.length === 0 && <p className="p-4 text-sm text-text-secondary">No animals match.</p>}
            {animals?.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-bg-sunken">
                <input type="checkbox" className="mt-1" checked={isChecked(a)} onChange={() => toggle(a)} aria-label={`Assign ${a.tag_serial ?? `animal ${a.id}`}`} />
                <span className="min-w-0 flex-1">
                  <span className="font-mono-ids block truncate text-sm text-text-primary">{a.tag_serial ?? `Animal ${a.id}`} · {a.loan_number ?? "no loan"}</span>
                  <span className="block truncate text-[0.8125rem] text-text-secondary">
                    {a.borrower_name ?? "—"} ·{" "}
                    {a.geofence_id === fence.id ? "On this fence" : a.geofence_name ? `Now on ${a.geofence_name}` : "No fence"}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {error && <p role="alert" className="mt-3 text-sm text-status-breach">{error}</p>}
          <div className="mt-4 flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-text-secondary tabular-nums">{changes.size} change{changes.size === 1 ? "" : "s"}</span>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button busy={busy} disabled={changes.size === 0} onClick={() => void save()}>{busy ? "Saving…" : "Save assignment"}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
