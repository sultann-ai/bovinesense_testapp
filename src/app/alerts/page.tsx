"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ShieldAlert, Truck, WifiOff, AlertTriangle, CheckCircle, Info,
  X, ChevronDown, Check, MoreHorizontal,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type AlertType = "breach" | "near_boundary" | "fast_movement" | "tag_offline" | "low_battery" | "returned";
type Severity  = "critical" | "warning" | "info";
type Status    = "new" | "acknowledged" | "assigned" | "resolved";

interface AlertRow {
  id: number;
  type: AlertType;
  severity: Severity;
  status: Status;
  title: string;
  detail: string | null;
  distance_km: number | null;
  created_at: string;
  resolved_at: string | null;
  resolution_reason: string | null;
  animal_id: number;
  animal_name: string | null;
  tag_serial: string | null;
  borrower_name: string | null;
  loan_number: string | null;
  branch_id: number;
  branch_name: string;
}

interface AuditEvent {
  id: number;
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
  user_name: string | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CFG: Record<AlertType, { icon: React.ElementType; label: string; solid: string; tint: string }> = {
  breach:        { icon: ShieldAlert,   label: "Breach",          solid: "var(--status-breach)", tint: "var(--status-breach-tint)" },
  near_boundary: { icon: AlertTriangle, label: "Near boundary",   solid: "var(--status-near)",   tint: "var(--status-near-tint)" },
  fast_movement: { icon: Truck,         label: "Fast movement",   solid: "var(--status-fast)",   tint: "var(--status-fast-tint)" },
  tag_offline:   { icon: WifiOff,       label: "Tag offline",     solid: "var(--status-stale)",  tint: "var(--status-stale-tint)" },
  low_battery:   { icon: Info,          label: "Low battery",     solid: "var(--status-info)",   tint: "var(--status-info-tint)" },
  returned:      { icon: CheckCircle,   label: "Returned",        solid: "var(--status-inside)", tint: "var(--status-inside-tint)" },
};

const STATUS_LABELS: Record<Status, string> = {
  new: "New", acknowledged: "Acknowledged", assigned: "Assigned", resolved: "Resolved",
};

const RESOLUTION_REASONS = [
  { value: "returned_home",            label: "Returned home" },
  { value: "false_alarm",              label: "False alarm" },
  { value: "moved_with_bank_consent",  label: "Moved with bank consent" },
  { value: "escalated_to_recovery",    label: "Escalated to recovery" },
] as const;

const TYPE_FILTERS: { value: AlertType | ""; label: string }[] = [
  { value: "",              label: "All types" },
  { value: "breach",        label: "Breach" },
  { value: "near_boundary", label: "Near boundary" },
  { value: "fast_movement", label: "Fast movement" },
  { value: "tag_offline",   label: "Tag offline" },
  { value: "low_battery",   label: "Low battery" },
];

const STATUS_FILTERS: { value: Status | ""; label: string }[] = [
  { value: "",             label: "All statuses" },
  { value: "new",          label: "New" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "assigned",     label: "Assigned" },
  { value: "resolved",     label: "Resolved" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString("en-PK", {
    timeZone: "Asia/Karachi", day: "numeric", month: "short",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypePill({ type }: { type: AlertType }) {
  const cfg  = TYPE_CFG[type];
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: cfg.tint, color: cfg.solid }}
    >
      <Icon size={11} strokeWidth={1.5} />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const colors: Record<Status, { bg: string; fg: string }> = {
    new:          { bg: "var(--brand-tint)",           fg: "var(--brand)" },
    acknowledged: { bg: "var(--status-near-tint)",     fg: "var(--status-near)" },
    assigned:     { bg: "var(--status-fast-tint)",     fg: "var(--status-fast)" },
    resolved:     { bg: "var(--status-inside-tint)",   fg: "var(--status-inside)" },
  };
  const c = colors[status];
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 8 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded animate-pulse" style={{ backgroundColor: "var(--bg-sunken)", width: `${60 + (i * 17) % 40}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ─── Resolve Dialog ───────────────────────────────────────────────────────────

function ResolveDialog({
  alertId,
  open,
  onClose,
  onResolved,
}: {
  alertId: number;
  open: boolean;
  onClose: () => void;
  onResolved: (id: number) => void;
}) {
  const [reason, setReason] = useState("");
  const [note,   setNote]   = useState("");
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function submit() {
    if (!reason) { setError("Resolution reason is required."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/alerts/${alertId}/transition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_status: "resolved", resolution_reason: reason, resolution_note: note || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Failed to resolve alert.");
        return;
      }
      onResolved(alertId);
      onClose();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border p-6 shadow-[var(--shadow-float)]"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)" }}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-text-primary">
              Resolve alert
            </Dialog.Title>
            <button onClick={onClose} className="rounded p-1 text-text-secondary hover:bg-bg-sunken">
              <X size={16} />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">
                Resolution reason <span style={{ color: "var(--status-breach)" }}>*</span>
              </label>
              <div className="relative">
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full appearance-none rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none"
                  style={{
                    borderColor: error && !reason ? "var(--status-breach)" : "var(--border)",
                    backgroundColor: "var(--bg-sunken)",
                    color: reason ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  <option value="">Select a reason…</option>
                  {RESOLUTION_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">
                Note <span className="normal-case font-normal">(optional)</span>
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Add context or next steps…"
                className="w-full rounded-[var(--radius-sm)] border px-3 py-2 text-sm outline-none resize-none"
                style={{
                  borderColor: "var(--border)",
                  backgroundColor: "var(--bg-sunken)",
                  color: "var(--text-primary)",
                }}
              />
            </div>

            {error && (
              <p className="text-xs" style={{ color: "var(--status-breach)" }}>{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm text-text-secondary hover:bg-bg-sunken transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: "var(--status-inside)" }}
              >
                {busy ? "Saving…" : "Resolve alert"}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  alertId,
  onClose,
  onTransition,
}: {
  alertId: number;
  onClose: () => void;
  onTransition: (id: number, toStatus: Status) => void;
}) {
  const [data,    setData]    = useState<(AlertRow & { audit: AuditEvent[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolveOpen, setResolveOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/alerts/${alertId}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [alertId]);

  async function ack() {
    await fetch(`/api/alerts/${alertId}/transition`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to_status: "acknowledged" }),
    });
    onTransition(alertId, "acknowledged");
    setData((d) => d ? { ...d, status: "acknowledged" } : d);
  }

  if (loading) {
    return (
      <aside className="w-[360px] shrink-0 border-l overflow-y-auto" style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-surface)" }}>
        <div className="p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 rounded animate-pulse" style={{ backgroundColor: "var(--bg-sunken)", width: `${50 + (i * 19) % 40}%` }} />
          ))}
        </div>
      </aside>
    );
  }

  if (!data) return null;

  const cfg = TYPE_CFG[data.type];

  return (
    <aside
      className="w-[360px] shrink-0 border-l flex flex-col overflow-hidden"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-surface)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-4 border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <TypePill type={data.type} />
          <p className="mt-2 text-sm font-semibold text-text-primary leading-snug">{data.title}</p>
          {data.detail && <p className="mt-1 text-xs text-text-secondary">{data.detail}</p>}
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-1 text-text-secondary hover:bg-bg-sunken">
          <X size={16} />
        </button>
      </div>

      {/* Animal details */}
      <div className="p-4 space-y-2 border-b text-sm" style={{ borderColor: "var(--border)" }}>
        {data.tag_serial && (
          <div className="flex justify-between">
            <span className="text-text-secondary text-xs">Tag</span>
            <span className="font-mono-ids text-text-primary">{data.tag_serial}</span>
          </div>
        )}
        {data.borrower_name && (
          <div className="flex justify-between">
            <span className="text-text-secondary text-xs">Borrower</span>
            <span className="text-text-primary">{data.borrower_name}</span>
          </div>
        )}
        {data.loan_number && (
          <div className="flex justify-between">
            <span className="text-text-secondary text-xs">Loan</span>
            <span className="font-mono-ids text-text-secondary">{data.loan_number}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-text-secondary text-xs">Branch</span>
          <span className="text-text-primary">{data.branch_name}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-secondary text-xs">Status</span>
          <StatusBadge status={data.status} />
        </div>
        <div className="flex justify-between">
          <span className="text-text-secondary text-xs">Raised</span>
          <span className="text-text-secondary text-xs" title={absoluteTime(data.created_at)}>{relativeTime(data.created_at)}</span>
        </div>
        {data.distance_km != null && (
          <div className="flex justify-between">
            <span className="text-text-secondary text-xs">Distance outside</span>
            <span className="tabular-nums text-xs text-text-primary">{(data.distance_km * 1000).toFixed(0)} m</span>
          </div>
        )}
      </div>

      {/* Actions */}
      {data.status !== "resolved" && (
        <div className="p-4 flex flex-col gap-2 border-b" style={{ borderColor: "var(--border)" }}>
          {data.status === "new" && (
            <button
              onClick={ack}
              className="w-full rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-medium transition-colors hover:bg-bg-sunken"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
            >
              Acknowledge
            </button>
          )}
          <button
            onClick={() => setResolveOpen(true)}
            className="w-full rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: "var(--status-inside)" }}
          >
            Resolve…
          </button>
        </div>
      )}

      {/* Audit trail */}
      <div className="flex-1 overflow-y-auto p-4">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.04em] text-text-secondary">
          Audit trail
        </p>
        {data.audit.length === 0 ? (
          <p className="text-xs text-text-secondary">No events recorded.</p>
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[7px] top-1 bottom-1 w-px" style={{ backgroundColor: "var(--border)" }} />
            <div className="space-y-3">
              {data.audit.map((ev) => (
                <div key={ev.id} className="relative pl-5">
                  <div
                    className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2"
                    style={{
                      borderColor: "var(--bg-surface)",
                      backgroundColor: ev.to_status === "resolved"
                        ? "var(--status-inside)"
                        : ev.to_status === "new"
                        ? "var(--status-breach)"
                        : "var(--status-near)",
                    }}
                  />
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs font-medium capitalize text-text-primary">{ev.to_status}</span>
                      {ev.from_status && (
                        <span className="text-[10px] text-text-secondary">← {ev.from_status}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {ev.user_name && <span className="text-[10px] text-text-secondary">{ev.user_name}</span>}
                      <span className="text-[10px] text-text-secondary">{relativeTime(ev.created_at)}</span>
                    </div>
                    {ev.note && (
                      <p className="mt-1 text-xs text-text-secondary italic">{ev.note}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {resolveOpen && (
        <ResolveDialog
          alertId={alertId}
          open={resolveOpen}
          onClose={() => setResolveOpen(false)}
          onResolved={(id) => onTransition(id, "resolved")}
        />
      )}
    </aside>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [alerts,    setAlerts]    = useState<AlertRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error503,  setError503]  = useState(false);
  const [typeFilter,   setTypeFilter]   = useState<AlertType | "">("");
  const [statusFilter, setStatusFilter] = useState<Status | "">("");
  const [selected,  setSelected]  = useState<number | null>(null);
  const [checked,   setChecked]   = useState<Set<number>>(new Set());
  const [bulkBusy,  setBulkBusy]  = useState(false);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter)   params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);
      const rows = await fetch(`/api/alerts?${params}`).then((r) => r.json());
      if (!Array.isArray(rows)) { setError503(true); return; }
      setAlerts(rows);
      setError503(false);
    } catch {
      setError503(true);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  const newCount = alerts.filter((a) => a.status === "new").length;

  function toggleCheck(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const visible = alerts.map((a) => a.id);
    setChecked((prev) => prev.size === visible.length ? new Set() : new Set(visible));
  }

  async function bulkAcknowledge() {
    if (!checked.size) return;
    setBulkBusy(true);
    await Promise.all(
      Array.from(checked).map((id) =>
        fetch(`/api/alerts/${id}/transition`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to_status: "acknowledged" }),
        }),
      ),
    );
    setBulkBusy(false);
    setChecked(new Set());
    fetchAlerts();
  }

  function handleTransition(id: number, toStatus: Status) {
    setAlerts((prev) =>
      prev.map((a) => a.id === id ? { ...a, status: toStatus } : a),
    );
    if (toStatus === "resolved") setSelected(null);
  }

  return (
    <div className="flex h-full gap-0 -m-6 overflow-hidden">
      {/* Main table area */}
      <div className="flex flex-1 flex-col overflow-hidden p-6">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Alerts</h1>
            <p className="mt-1 text-sm text-text-secondary">All events — with status, owner, and audit trail.</p>
          </div>
          {newCount > 0 && (
            <span
              className="flex h-7 min-w-[40px] items-center justify-center rounded-full px-2.5 text-xs font-semibold text-white tabular-nums"
              style={{ backgroundColor: "var(--status-breach)" }}
            >
              {newCount} new
            </span>
          )}
        </div>

        {/* Filter chips */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value as AlertType | "")}
              className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              style={{
                borderColor:     typeFilter === f.value ? "var(--brand)" : "var(--border)",
                backgroundColor: typeFilter === f.value ? "var(--brand-tint)" : "var(--bg-surface)",
                color:           typeFilter === f.value ? "var(--brand)" : "var(--text-secondary)",
              }}
            >
              {f.label}
            </button>
          ))}
          <div className="w-px h-5 mx-1" style={{ backgroundColor: "var(--border)" }} />
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value as Status | "")}
              className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
              style={{
                borderColor:     statusFilter === f.value ? "var(--brand)" : "var(--border)",
                backgroundColor: statusFilter === f.value ? "var(--brand-tint)" : "var(--bg-surface)",
                color:           statusFilter === f.value ? "var(--brand)" : "var(--text-secondary)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Bulk action bar */}
        {checked.size > 0 && (
          <div
            className="mb-3 flex items-center gap-3 rounded-[var(--radius-sm)] border px-4 py-2.5"
            style={{ backgroundColor: "var(--brand-tint)", borderColor: "var(--brand)" }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--brand)" }}>
              {checked.size} selected
            </span>
            <button
              onClick={bulkAcknowledge}
              disabled={bulkBusy}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--brand)" }}
            >
              {bulkBusy ? "Acknowledging…" : "Acknowledge all"}
            </button>
            <button
              onClick={() => setChecked(new Set())}
              className="ml-auto text-xs"
              style={{ color: "var(--brand)" }}
            >
              Clear
            </button>
          </div>
        )}

        {/* Table */}
        <div
          className="flex-1 overflow-auto rounded-[var(--radius-md)] border"
          style={{ borderColor: "var(--border)" }}
        >
          {error503 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2">
              <p className="text-sm text-text-secondary">Could not connect to database.</p>
              <button
                onClick={fetchAlerts}
                className="rounded-[var(--radius-sm)] border px-4 py-2 text-xs font-medium text-text-secondary hover:bg-bg-sunken transition-colors"
                style={{ borderColor: "var(--border)" }}
              >
                Retry
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: "var(--bg-sunken)" }}>
                  <th className="pl-4 pr-2 py-3">
                    <input
                      type="checkbox"
                      checked={alerts.length > 0 && checked.size === alerts.length}
                      onChange={toggleAll}
                      className="cursor-pointer"
                    />
                  </th>
                  {["Type", "Event", "Tag ID", "Borrower", "Loan ID", "Branch", "Raised", "Status", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.04em] text-text-secondary whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                ) : alerts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center">
                      <p className="text-sm text-text-secondary">No alerts matching these filters.</p>
                      <button
                        onClick={() => { setTypeFilter(""); setStatusFilter(""); }}
                        className="mt-2 text-xs"
                        style={{ color: "var(--brand-hover)" }}
                      >
                        Clear filters
                      </button>
                    </td>
                  </tr>
                ) : (
                  alerts.map((alert) => (
                    <tr
                      key={alert.id}
                      onClick={() => setSelected(selected === alert.id ? null : alert.id)}
                      className="cursor-pointer transition-colors"
                      style={{
                        backgroundColor: selected === alert.id ? "var(--brand-tint)" : undefined,
                      }}
                      onMouseEnter={(e) => {
                        if (selected !== alert.id) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-sunken)";
                      }}
                      onMouseLeave={(e) => {
                        if (selected !== alert.id) (e.currentTarget as HTMLElement).style.backgroundColor = "";
                      }}
                    >
                      <td
                        className="pl-4 pr-2 py-3"
                        onClick={(e) => { e.stopPropagation(); toggleCheck(alert.id); }}
                      >
                        <input
                          type="checkbox"
                          checked={checked.has(alert.id)}
                          onChange={() => toggleCheck(alert.id)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3"><TypePill type={alert.type} /></td>
                      <td className="px-4 py-3 font-medium text-text-primary max-w-[200px] truncate">{alert.title}</td>
                      <td className="px-4 py-3 font-mono-ids text-text-secondary">{alert.tag_serial ?? "—"}</td>
                      <td className="px-4 py-3 text-text-primary">{alert.borrower_name ?? "—"}</td>
                      <td className="px-4 py-3 font-mono-ids text-text-secondary">{alert.loan_number ?? "—"}</td>
                      <td className="px-4 py-3 text-text-secondary">{alert.branch_name}</td>
                      <td
                        className="px-4 py-3 text-text-secondary whitespace-nowrap text-xs"
                        title={absoluteTime(alert.created_at)}
                      >
                        {relativeTime(alert.created_at)}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={alert.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <Check size={14} className="opacity-40" style={{ color: selected === alert.id ? "var(--brand)" : "transparent" }} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selected !== null && (
        <DetailPanel
          alertId={selected}
          onClose={() => setSelected(null)}
          onTransition={handleTransition}
        />
      )}
    </div>
  );
}
