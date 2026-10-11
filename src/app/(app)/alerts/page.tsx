"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle, Download, Info, ShieldAlert, Truck, WifiOff, X, type LucideIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Pill, type PillTone } from "@/components/ui/status-pill";
import { EmptyState, ErrorState, SkeletonLines } from "@/components/ui/states";
import { Timestamp } from "@/components/ui/timestamp";
import { AssignDialog, ResolveDialog } from "@/components/alerts/AlertDialogs";
import { usePermissions } from "@/components/shell/PermissionsProvider";
import { useScope } from "@/components/shell/ScopeProvider";
import { useLiveEvents, useResync } from "@/components/realtime/RealtimeProvider";

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

const TYPE_CFG: Record<AlertType, { icon: LucideIcon; label: string; tone: PillTone }> = {
  breach:        { icon: ShieldAlert,   label: "Breach",        tone: "breach" },
  near_boundary: { icon: AlertTriangle, label: "Near boundary", tone: "near" },
  fast_movement: { icon: Truck,         label: "Fast movement", tone: "fast" },
  tag_offline:   { icon: WifiOff,       label: "Tag offline",   tone: "stale" },
  low_battery:   { icon: Info,          label: "Low battery",   tone: "info" },
  returned:      { icon: CheckCircle,   label: "Returned",      tone: "inside" },
};

const STATE_CFG: Record<Status, { label: string; tone: PillTone }> = {
  new:          { label: "New",          tone: "brand" },
  acknowledged: { label: "Acknowledged", tone: "near" },
  assigned:     { label: "Assigned",     tone: "fast" },
  resolved:     { label: "Resolved",     tone: "inside" },
};

const TYPE_FILTERS = [
  { value: "breach",        label: "Breach" },
  { value: "near_boundary", label: "Near boundary" },
  { value: "fast_movement", label: "Fast movement" },
  { value: "tag_offline",   label: "Tag offline" },
  { value: "low_battery",   label: "Low battery" },
];

const STATE_FILTERS = [
  { value: "new",          label: "New" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "assigned",     label: "Assigned" },
  { value: "resolved",     label: "Resolved" },
];

// ─── Small pieces ─────────────────────────────────────────────────────────────

function TypePill({ type }: { type: AlertType }) {
  const cfg = TYPE_CFG[type];
  return <Pill tone={cfg.tone} label={cfg.label} icon={cfg.icon} />;
}

function StatePill({ status }: { status: Status }) {
  const cfg = STATE_CFG[status];
  return <Pill tone={cfg.tone} label={cfg.label} />;
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

type Detail = AlertRow & { audit: AuditEvent[] };

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-sm text-text-primary">{children}</span>
    </div>
  );
}

function DetailPanel({
  alertId, onClose, onTransition,
}: { alertId: number; onClose: () => void; onTransition: (id: number, toStatus: Status) => void }) {
  const [loaded, setLoaded] = useState<{ id: number; data: Detail | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<"assign" | "resolve" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { can } = usePermissions();
  const canAck = can("alerts:acknowledge");
  const canResolve = can("alerts:resolve");
  const canAssign = can("alerts:assign");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/alerts/${alertId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Detail) => { if (!cancelled) setLoaded({ id: alertId, data }); })
      .catch(() => { if (!cancelled) setLoaded({ id: alertId, data: null }); });
    return () => { cancelled = true; };
  }, [alertId, attempt]);

  const mine = loaded !== null && loaded.id === alertId ? loaded : null;
  const data = mine?.data ?? null;

  async function ack() {
    setActionError(null);
    try {
      const res = await fetch(`/api/alerts/${alertId}/transition`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to_status: "acknowledged" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onTransition(alertId, "acknowledged");
      setAttempt((a) => a + 1); // reload the state and the audit trail
    } catch {
      setActionError("The alert could not be acknowledged. Try again.");
    }
  }

  return (
    <aside aria-label="Alert details" className="flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-border bg-bg-surface">
      {mine === null && (
        <div className="p-4">
          <SkeletonLines rows={6} label="Loading alert" />
        </div>
      )}

      {mine !== null && data === null && (
        <ErrorState what="This alert could not be loaded." onRetry={() => { setLoaded(null); setAttempt((a) => a + 1); }} />
      )}

      {data && (
        <>
          <div className="flex items-start justify-between gap-2 border-b border-border p-4">
            <div>
              <TypePill type={data.type} />
              <p className="mt-2 text-sm font-semibold leading-snug text-text-primary">{data.title}</p>
              {data.detail && <p className="mt-1 text-[0.8125rem] leading-[1.125rem] text-text-secondary">{data.detail}</p>}
            </div>
            <Button variant="ghost" size="icon" aria-label="Close details" onClick={onClose}><X size={20} strokeWidth={1.5} /></Button>
          </div>

          <div className="space-y-2 border-b border-border p-4">
            {data.tag_serial && <DetailRow label="Tag"><span className="font-mono-ids">{data.tag_serial}</span></DetailRow>}
            {data.borrower_name && <DetailRow label="Borrower">{data.borrower_name}</DetailRow>}
            {data.loan_number && <DetailRow label="Loan"><span className="font-mono-ids text-text-secondary">{data.loan_number}</span></DetailRow>}
            <DetailRow label="Branch">{data.branch_name}</DetailRow>
            <DetailRow label="State"><StatePill status={data.status} /></DetailRow>
            <DetailRow label="Raised"><Timestamp value={data.created_at} /></DetailRow>
            {data.distance_km != null && <DetailRow label="Distance outside"><span className="tabular-nums">{(data.distance_km * 1000).toFixed(0)} m</span></DetailRow>}
          </div>

          {data.status !== "resolved" && !canAck && !canResolve && !canAssign && (
            <p className="border-b border-border p-4 text-[0.8125rem] leading-[1.125rem] text-text-secondary">
              Read-only access: your role can view this alert but not change it.
            </p>
          )}
          {data.status !== "resolved" && (canAck || canResolve || canAssign) && (
            <div className="flex flex-col gap-2 border-b border-border p-4">
              {data.status === "new" && canAck && <Button variant="secondary" onClick={() => void ack()}>Acknowledge</Button>}
              {data.status !== "assigned" && canAssign && <Button variant="secondary" onClick={() => setDialog("assign")}>Assign…</Button>}
              {canResolve && <Button onClick={() => setDialog("resolve")}>Resolve…</Button>}
              {actionError && <p role="alert" className="text-[0.8125rem] text-status-breach">{actionError}</p>}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="mb-3 text-xs font-medium uppercase leading-4 tracking-[0.04em] text-text-secondary">Audit trail</h3>
            {data.audit.length === 0 ? (
              <p className="text-[0.8125rem] text-text-secondary">No events recorded yet.</p>
            ) : (
              <ol className="relative space-y-3">
                <span aria-hidden className="absolute bottom-1 left-[7px] top-1 w-px bg-border" />
                {data.audit.map((ev) => (
                  <li key={ev.id} className="relative pl-5">
                    <span
                      aria-hidden
                      className={`absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 border-bg-surface ${
                        ev.to_status === "resolved" ? "bg-status-inside" : ev.to_status === "new" ? "bg-status-breach" : "bg-status-near"
                      }`}
                    />
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[0.8125rem] font-medium capitalize text-text-primary">{ev.to_status}</span>
                      {ev.from_status && <span className="text-xs text-text-secondary">from {ev.from_status}</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      {ev.user_name && <span className="text-xs text-text-secondary">{ev.user_name}</span>}
                      <Timestamp value={ev.created_at} />
                    </div>
                    {ev.note && <p className="mt-1 text-[0.8125rem] italic text-text-secondary">{ev.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {dialog === "resolve" && (
            <ResolveDialog alertId={alertId} open onClose={() => setDialog(null)} onDone={(id) => onTransition(id, "resolved")} />
          )}
          {dialog === "assign" && (
            <AssignDialog
              alertId={alertId}
              open
              onClose={() => setDialog(null)}
              onDone={(id) => { onTransition(id, "assigned"); setAttempt((a) => a + 1); }}
            />
          )}
        </>
      )}
    </aside>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const router = useRouter();
  const scope = useScope();
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  // Date range (YYYY-MM-DD, whole days) and branch: they narrow the list and the CSV export alike.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number | string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const { can } = usePermissions();
  const canAck = can("alerts:acknowledge");

  // One request per (type, state, scope). Until its answer arrives the table shows skeleton rows; a
  // live refresh just asks again and swaps the rows in place.
  const scopeKey = scope.key;
  const queryKey = `${typeFilter ?? ""}|${stateFilter ?? ""}|${fromDate}|${toDate}|${branchFilter}|${scopeKey}`;
  const [result, setResult] = useState<{ key: string; rows: AlertRow[]; failed: boolean } | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(withFilters("/api/alerts"), { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((rows: unknown) => {
        if (!Array.isArray(rows)) throw new Error("unexpected response");
        if (!cancelled) setResult({ key: queryKey, rows, failed: false });
      })
      .catch(() => { if (!cancelled) setResult({ key: queryKey, rows: [], failed: true }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope.scoped changes with scopeKey, which is in queryKey
  }, [queryKey, refresh]);

  /** The path with the current filters; a branch chosen here replaces the one from the top-bar scope. */
  function withFilters(path: string): string {
    const url = new URL(scope.scoped(path), "http://local");
    if (typeFilter) url.searchParams.set("type", typeFilter);
    if (stateFilter) url.searchParams.set("status", stateFilter);
    if (fromDate) url.searchParams.set("from_date", fromDate);
    if (toDate) url.searchParams.set("to_date", toDate);
    if (branchFilter) url.searchParams.set("branch_id", branchFilter);
    return url.pathname + url.search;
  }

  const loading = result === null || result.key !== queryKey;
  const alerts = result?.rows ?? [];
  const failed = !loading && result.failed;
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const retry = () => { setResult(null); reload(); };

  // Live: any alert change (new, or acknowledged / assigned / resolved by someone) refreshes the
  // list once things settle; and after a reconnect everything is refetched.
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvents((event) => {
    if (event.kind !== "alert") return;
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => { liveTimer.current = null; reload(); }, 700);
  });
  useResync(reload);
  useEffect(() => () => { if (liveTimer.current) clearTimeout(liveTimer.current); }, []);

  const newCount = alerts.filter((a) => a.status === "new").length;

  function toggleCheck(id: number | string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) => (prev.size === alerts.length ? new Set() : new Set(alerts.map((a) => a.id))));
  }

  async function bulkAcknowledge() {
    if (!checked.size) return;
    setBulkBusy(true);
    setBulkError(null);
    const results = await Promise.all(
      Array.from(checked).map((id) =>
        fetch(`/api/alerts/${id}/transition`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to_status: "acknowledged" }),
        }).then((r) => r.ok).catch(() => false),
      ),
    );
    setBulkBusy(false);
    const failures = results.filter((ok) => !ok).length;
    if (failures > 0) setBulkError(`${failures} of ${results.length} alerts could not be acknowledged (already handled, or outside your access).`);
    setChecked(new Set());
    setResult(null);
    reload();
  }

  function handleTransition(id: number, toStatus: Status) {
    setResult((r) => (r ? { ...r, rows: r.rows.map((a) => (a.id === id ? { ...a, status: toStatus } : a)) } : r));
    if (toStatus === "resolved") setSelected(null);
  }

  const columns: Column<AlertRow>[] = [
    { key: "type", header: "Type", cell: (a) => <TypePill type={a.type} /> },
    { key: "event", header: "Event", cell: (a) => <span className="block max-w-[200px] truncate font-medium text-text-primary">{a.title}</span> },
    { key: "tag", header: "Tag ID", cell: (a) => a.tag_serial ?? "—", className: "font-mono-ids text-text-secondary" },
    { key: "borrower", header: "Borrower", cell: (a) => a.borrower_name ?? "—", className: "text-text-primary" },
    { key: "loan", header: "Loan ID", cell: (a) => a.loan_number ?? "—", className: "font-mono-ids text-text-secondary" },
    { key: "branch", header: "Branch", cell: (a) => a.branch_name, className: "text-text-secondary" },
    { key: "raised", header: "Raised", cell: (a) => <Timestamp value={a.created_at} /> },
    { key: "state", header: "State", cell: (a) => <StatePill status={a.status} /> },
  ];

  const filtered = typeFilter !== null || stateFilter !== null || fromDate !== "" || toDate !== "" || branchFilter !== "";
  const clearFilters = () => { setTypeFilter(null); setStateFilter(null); setFromDate(""); setToDate(""); setBranchFilter(""); };

  return (
    <div className="-m-6 flex h-full overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold leading-8 text-text-primary">Alerts</h1>
            <p className="mt-1 text-sm text-text-secondary">Every event, with its state, owner and audit trail.</p>
          </div>
          <a
            href={withFilters("/api/alerts/export")}
            download
            className={buttonVariants({ variant: "secondary" })}
          >
            <Download size={16} strokeWidth={1.5} aria-hidden /> Export CSV
          </a>
          {newCount > 0 && (
            <span className="flex h-7 min-w-10 items-center justify-center rounded-full bg-status-breach px-3 text-xs font-semibold tabular-nums text-white">
              {newCount} new
            </span>
          )}
        </div>

        <div className="mb-2 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">
            From
            <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} className="mt-1 block h-9 rounded-[var(--radius-sm)] border border-border bg-bg-sunken px-2 text-sm normal-case text-text-primary" />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">
            To
            <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} className="mt-1 block h-9 rounded-[var(--radius-sm)] border border-border bg-bg-sunken px-2 text-sm normal-case text-text-primary" />
          </label>
          <label className="text-xs font-medium uppercase tracking-[0.04em] text-text-secondary">
            Branch
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="mt-1 block h-9 min-w-40 rounded-[var(--radius-sm)] border border-border bg-bg-sunken px-2 text-sm normal-case text-text-primary">
              <option value="">All branches</option>
              {scope.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>

        <div className="mb-4">
          <FilterBar
            inline
            groups={[
              { key: "type", label: "Alert type", options: TYPE_FILTERS, value: typeFilter, onChange: setTypeFilter },
              { key: "state", label: "Alert state", options: STATE_FILTERS, value: stateFilter, onChange: setStateFilter },
            ]}
            onClearAll={clearFilters}
          />
        </div>

        {canAck && checked.size > 0 && (
          <div className="mb-3 flex items-center gap-3 rounded-[var(--radius-sm)] border border-brand bg-brand-tint px-4 py-2" role="region" aria-label="Bulk actions">
            <span className="text-sm font-medium text-brand-hover">{checked.size} selected</span>
            <Button busy={bulkBusy} onClick={() => void bulkAcknowledge()}>{bulkBusy ? "Acknowledging…" : "Acknowledge all"}</Button>
            <Button variant="ghost" className="ml-auto" onClick={() => setChecked(new Set())}>Clear</Button>
          </div>
        )}
        {bulkError && <p role="alert" className="mb-3 text-sm text-status-breach">{bulkError}</p>}

        <DataTable
          className="flex-1"
          label="Alerts"
          columns={columns}
          rows={alerts}
          getRowId={(a) => a.id}
          loading={loading}
          skeletonRows={6}
          error={failed ? { what: "The alerts could not be loaded.", onRetry: retry } : null}
          selectedId={selected}
          onRowClick={(a) => setSelected(selected === a.id ? null : a.id)}
          onLocate={(a) => router.push(`/?animal=${a.animal_id}`)}
          selection={canAck ? { checked, onToggle: toggleCheck, onToggleAll: toggleAll } : undefined}
          empty={
            filtered ? (
              <EmptyState title="No alerts match these filters." action={{ label: "Clear filters", onClick: clearFilters }} />
            ) : (
              <EmptyState
                icon={<CheckCircle size={20} strokeWidth={1.5} className="text-status-inside-text" />}
                title="No alerts in this view. Every animal is where it should be."
                action={{ label: "Open Overview", href: "/" }}
              />
            )
          }
        />
      </div>

      {selected !== null && <DetailPanel alertId={selected} onClose={() => setSelected(null)} onTransition={handleTransition} />}
    </div>
  );
}
