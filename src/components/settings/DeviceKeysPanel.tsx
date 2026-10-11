"use client";

import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, KeyRound, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/states";
import { Timestamp } from "@/components/ui/timestamp";
import { usePermissions } from "@/components/shell/PermissionsProvider";
import { DEVICE_KEY_LABEL_MAX } from "@/lib/device-keys-shared";

interface KeyRow {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
interface CreatedKey extends KeyRow {
  /** The plain key. Present only in the response to creating it. */
  key: string;
}

async function fetchKeys(): Promise<KeyRow[]> {
  const res = await fetch("/api/device-keys", { cache: "no-store" });
  const rows: unknown = await res.json();
  if (!res.ok || !Array.isArray(rows)) throw new Error("bad response");
  return rows as KeyRow[];
}

/** The list row for a just-created key: everything except the plain key, which is never kept. */
function withoutSecret(k: CreatedKey): KeyRow {
  return {
    id: k.id,
    label: k.label,
    key_prefix: k.key_prefix,
    created_at: k.created_at,
    last_used_at: k.last_used_at,
    revoked_at: k.revoked_at,
  };
}

const labelClass = "mb-1 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary";
const inputStyle = { borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)", color: "var(--text-primary)" };

/**
 * Settings → Device keys. Keys are what tags, gateways and the simulator send in `x-api-key`.
 * The plain key exists on screen exactly once, right after it is created.
 */
export function DeviceKeysPanel() {
  const { can } = usePermissions();
  const canManage = can("devices:manage");

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<KeyRow | null>(null);

  // First load: state only changes after the request settles, never synchronously in the effect.
  useEffect(() => {
    let cancelled = false;
    fetchKeys()
      .then((rows) => { if (!cancelled) { setKeys(rows); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  /** Reload after a change, or when the user presses Retry. Called from event handlers only. */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setKeys(await fetchKeys());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const active = keys.filter((k) => !k.revoked_at).length;

  const columns: Column<KeyRow>[] = [
    { key: "label", header: "Name", cell: (k) => k.label, className: "text-text-primary" },
    { key: "key", header: "Key", cell: (k) => <>{k.key_prefix}…</>, className: "font-mono-ids text-text-secondary" },
    { key: "created", header: "Created", cell: (k) => <Timestamp value={k.created_at} /> },
    { key: "used", header: "Last used", cell: (k) => <Timestamp value={k.last_used_at} empty="Never" /> },
    {
      key: "status",
      header: "Status",
      cell: (k) => (k.revoked_at ? <Pill tone="stale" label="Revoked" icon={X} /> : <Pill tone="inside" label="Active" icon={Check} />),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (k) =>
        !k.revoked_at && canManage ? (
          <Button variant="ghost" className="text-status-breach hover:text-status-breach" aria-label={`Revoke key ${k.label}`} onClick={() => setRevokeTarget(k)}>
            Revoke
          </Button>
        ) : null,
    },
  ];

  return (
    <section
      className="rounded-[var(--radius-md)] border"
      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)" }}
      aria-labelledby="device-keys-title"
    >
      <div className="flex items-start justify-between gap-4 p-5 border-b" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 id="device-keys-title" className="text-lg font-semibold text-text-primary" style={{ lineHeight: "26px" }}>
            Device keys
          </h2>
          <p className="mt-1 text-sm text-text-secondary max-w-xl">
            Tags, gateways and the simulator send their readings with a key from this list, in the{" "}
            <span className="font-mono-ids">x-api-key</span> header. A key only ever reaches your own organization&apos;s
            animals. Each key is shown once when it is created; only a fingerprint is kept.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!canManage}>
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          Create key
        </Button>
      </div>

      <DataTable
        className="rounded-none border-0"
        label="Device keys"
        columns={columns}
        rows={keys}
        getRowId={(k) => k.id}
        loading={loading}
        skeletonRows={3}
        error={failed ? { what: "The keys could not be loaded.", onRetry: () => void reload() } : null}
        empty={
          <EmptyState
            icon={<KeyRound size={20} strokeWidth={1.5} />}
            title="No device keys yet. Create one to connect a tag or the simulator."
            action={canManage ? { label: "Create key", onClick: () => setCreateOpen(true) } : undefined}
          />
        }
      />

      {!loading && !failed && keys.length > 0 && (
        <p className="px-5 py-3 text-xs text-text-secondary border-t" style={{ borderColor: "var(--border)" }}>
          {active} active · {keys.length - active} revoked. A revoked key stops working on its next request and cannot be restored.
        </p>
      )}

      {createOpen && (
        <CreateDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(k) => setKeys((prev) => [withoutSecret(k), ...prev])}
        />
      )}
      {revokeTarget && (
        <RevokeDialog
          target={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onRevoked={() => void reload()}
        />
      )}
    </section>
  );
}

// ─── Create ────────────────────────────────────────────────────────────────────

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (k: CreatedKey) => void }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/device-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "The key could not be created.");
        return;
      }
      setCreated(body as CreatedKey);
      onCreated(body as CreatedKey);
    } catch {
      setError("The key could not be created. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      setCopied(false); // the key stays selectable in the box below
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o && !created) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border p-6 shadow-[var(--shadow-float)]"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)" }}
          // Closing by accident would lose the only chance to copy the key: require "Done".
          onInteractOutside={(e) => { if (created) e.preventDefault(); }}
          onEscapeKeyDown={(e) => { if (created) e.preventDefault(); }}
        >
          {!created ? (
            <form onSubmit={submit}>
              <Dialog.Title className="text-lg font-semibold text-text-primary mb-1" style={{ lineHeight: "26px" }}>
                Create device key
              </Dialog.Title>
              <Dialog.Description className="text-sm text-text-secondary mb-4">
                Name it after what will use it, for example &ldquo;North gateway&rdquo; or &ldquo;Simulator&rdquo;.
              </Dialog.Description>
              <label htmlFor="device-key-label" className={labelClass}>Name</label>
              <input
                id="device-key-label"
                autoFocus
                type="text"
                value={label}
                maxLength={DEVICE_KEY_LABEL_MAX}
                onChange={(e) => setLabel(e.target.value)}
                className="h-9 w-full rounded-[var(--radius-sm)] border px-3 text-sm outline-none"
                style={inputStyle}
              />
              {error && <p role="alert" className="mt-2 text-sm" style={{ color: "var(--status-breach)" }}>{error}</p>}
              <div className="mt-6 flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button type="submit" busy={busy} disabled={label.trim() === ""}>{busy ? "Creating…" : "Create key"}</Button>
              </div>
            </form>
          ) : (
            <div>
              <Dialog.Title className="text-lg font-semibold text-text-primary mb-1" style={{ lineHeight: "26px" }}>
                Key created
              </Dialog.Title>
              <Dialog.Description className="text-sm text-text-secondary mb-4">
                Copy the key now. For your security it will not be shown again; if it is lost, revoke it and create a new one.
              </Dialog.Description>
              <div
                className="flex items-center gap-2 rounded-[var(--radius-sm)] border p-3"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--bg-sunken)" }}
              >
                <code data-testid="new-device-key" className="font-mono-ids flex-1 break-all text-sm text-text-primary select-all">
                  {created.key}
                </code>
                <Button variant="secondary" size="icon" aria-label="Copy key" onClick={() => void copy()}>{copied ? <Check size={16} strokeWidth={1.5} /> : <Copy size={16} strokeWidth={1.5} />}</Button>
              </div>
              <p className="mt-3 text-sm text-text-secondary">
                Send it as the <span className="font-mono-ids">x-api-key</span> header to{" "}
                <span className="font-mono-ids">/api/ingest/fix</span>.
              </p>
              <div className="mt-6 flex justify-end">
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Revoke ────────────────────────────────────────────────────────────────────

function RevokeDialog({ target, onClose, onRevoked }: { target: KeyRow; onClose: () => void; onRevoked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/device-keys/${target.id}/revoke`, { method: "POST" });
      if (!res.ok && res.status !== 404) {
        setError("The key could not be revoked. Try again.");
        return;
      }
      onRevoked();
      onClose();
    } catch {
      setError("The key could not be revoked. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border p-6 shadow-[var(--shadow-float)]"
          style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)" }}
        >
          <Dialog.Title className="text-lg font-semibold text-text-primary mb-2" style={{ lineHeight: "26px" }}>
            Revoke this key?
          </Dialog.Title>
          <Dialog.Description className="text-sm text-text-secondary mb-4">
            <strong>{target.label}</strong> (<span className="font-mono-ids">{target.key_prefix}…</span>) will stop working
            on its next request. Devices using it must be given a new key. This cannot be undone.
          </Dialog.Description>
          {error && <p role="alert" className="mb-3 text-sm" style={{ color: "var(--status-breach)" }}>{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="destructive" busy={busy} onClick={() => void confirm()}>{busy ? "Revoking…" : "Revoke key"}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
