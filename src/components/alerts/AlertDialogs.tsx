"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";

/**
 * The Resolve and Assign dialogs, shared by the Overview alert feed and the Alerts page. Both call
 * PATCH /api/alerts/:id/transition; the server records who did it and writes the alert_events row.
 */

export const RESOLUTION_REASONS = [
  { value: "returned_home",         label: "Returned home" },
  { value: "false_alarm",           label: "False alarm" },
  { value: "moved_with_consent",    label: "Moved with consent" },
  { value: "escalated_to_recovery", label: "Escalated to recovery" },
] as const;

const fieldLabel = "mb-1.5 block text-xs font-medium uppercase leading-4 tracking-[0.04em] text-text-secondary";
const fieldBox = "w-full rounded-[var(--radius-sm)] border border-border bg-bg-sunken px-3 text-sm text-text-primary outline-none focus:border-brand focus:ring-1 focus:ring-brand/30";

async function transition(alertId: number, body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`/api/alerts/${alertId}/transition`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const d = await res.json().catch(() => ({}));
    return typeof d.error === "string" ? d.error : "The change could not be saved.";
  } catch {
    return "The change could not be saved. Check your connection and try again.";
  }
}

function DialogFrame({
  title, description, open, onClose, children,
}: { title: string; description: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-text-primary/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border border-border bg-bg-surface p-6 shadow-[var(--shadow-float)]">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold leading-[26px] text-text-primary">{title}</Dialog.Title>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X size={20} strokeWidth={1.5} /></Button>
          </div>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface DialogProps {
  alertId: number;
  open: boolean;
  onClose: () => void;
  /** Called after the server accepted the change. */
  onDone: (alertId: number) => void;
}

export function ResolveDialog({ alertId, open, onClose, onDone }: DialogProps) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason) { setError("Choose why this alert is being resolved."); return; }
    setBusy(true);
    setError(null);
    const failure = await transition(alertId, { to_status: "resolved", resolution_reason: reason, resolution_note: note.trim() || undefined });
    setBusy(false);
    if (failure) { setError(failure); return; }
    onDone(alertId);
    onClose();
  }

  return (
    <DialogFrame title="Resolve alert" description="Choose a reason and, if you like, add a note. This is recorded in the audit trail." open={open} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label htmlFor="resolve-reason" className={fieldLabel}>Resolution reason <span className="text-status-breach">*</span></label>
          <select id="resolve-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={`${fieldBox} h-9`}>
            <option value="">Select a reason…</option>
            {RESOLUTION_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="resolve-note" className={fieldLabel}>Note <span className="font-normal normal-case">(optional)</span></label>
          <textarea id="resolve-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add context or next steps…" className={`${fieldBox} resize-none py-2`} />
        </div>
        {error && <p role="alert" className="text-sm text-status-breach">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={busy} onClick={() => void submit()}>{busy ? "Saving…" : "Resolve alert"}</Button>
        </div>
      </div>
    </DialogFrame>
  );
}

interface Officer { user_id: string; full_name: string }

export function AssignDialog({ alertId, open, onClose, onDone }: DialogProps) {
  // `loaded` is tagged with the alert it answers, so a stale answer is never shown for another alert.
  const [loaded, setLoaded] = useState<{ id: number; officers: Officer[] | null } | null>(null);
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/alerts/${alertId}/assignees`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((officers: Officer[]) => { if (!cancelled) setLoaded({ id: alertId, officers }); })
      .catch(() => { if (!cancelled) setLoaded({ id: alertId, officers: null }); });
    return () => { cancelled = true; };
  }, [alertId, open]);

  const mine = loaded?.id === alertId ? loaded : null;
  const officers = mine?.officers ?? null;

  async function submit() {
    if (!assignee) { setError("Choose a branch officer."); return; }
    setBusy(true);
    setError(null);
    const failure = await transition(alertId, { to_status: "assigned", assignee_id: assignee });
    setBusy(false);
    if (failure) { setError(failure); return; }
    onDone(alertId);
    onClose();
  }

  return (
    <DialogFrame title="Assign alert" description="Choose a branch officer from this animal's branch. The assignment is recorded in the audit trail." open={open} onClose={onClose}>
      <div className="space-y-4">
        {mine === null && <p className="text-sm text-text-secondary" role="status">Loading branch officers…</p>}
        {mine !== null && officers === null && <p role="alert" className="text-sm text-status-breach">The branch officers could not be loaded. Close this and try again.</p>}
        {officers !== null && officers.length === 0 && (
          <p className="text-sm text-text-secondary">No branch officer is set up for this animal&apos;s branch. Ask an organization admin to add one.</p>
        )}
        {officers !== null && officers.length > 0 && (
          <div>
            <label htmlFor="assign-officer" className={fieldLabel}>Branch officer <span className="text-status-breach">*</span></label>
            <select id="assign-officer" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={`${fieldBox} h-9`}>
              <option value="">Select an officer…</option>
              {officers.map((o) => <option key={o.user_id} value={o.user_id}>{o.full_name}</option>)}
            </select>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-status-breach">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button busy={busy} disabled={!officers || officers.length === 0} onClick={() => void submit()}>{busy ? "Saving…" : "Assign alert"}</Button>
        </div>
      </div>
    </DialogFrame>
  );
}
