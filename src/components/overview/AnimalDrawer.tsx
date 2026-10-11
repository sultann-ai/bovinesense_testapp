"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, Route } from "lucide-react";
import { MiniMap } from "@/components/map/MiniMap";
import { formatCoord } from "@/lib/format";
import { AnimalDrawerFrame, type DrawerTab } from "@/components/ui/animal-drawer";
import { BatteryGlyph, SignalGlyph } from "@/components/ui/battery-signal";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/status-pill";
import { ErrorState, SkeletonLines } from "@/components/ui/states";
import { Timestamp } from "@/components/ui/timestamp";
import { useTenant } from "@/components/shell/TenantProvider";

interface AnimalDetail {
  id:              number;
  animal_name:     string | null;
  species:         string;
  sex:             string | null;
  age_years:       number | null;
  status:          string;
  tag_serial:      string | null;
  last_seen_at:    string | null;
  borrower_name:   string | null;
  cnic:            string | null;
  phone:           string | null;
  address:         string | null;
  loan_number:     string | null;
  amount_pkr:      number | null;
  loan_status:     string | null;
  branch_name:     string;
  region_name:     string | null;
  geofence_name:   string | null;
  warning_buffer_m: number | null;
  lat:             number | null;
  lon:             number | null;
  last_fix_at:     string | null;
  last_battery_pct: number | null;
  last_speed_kmh:  number | null;
  last_signal_bars: number | null;
  events:          Array<{
    id: number;
    type: string;
    severity: string;
    status: string;
    title: string;
    detail: string | null;
    created_at: string;
  }>;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase leading-4 tracking-[0.04em] text-text-secondary">{label}</dt>
      <dd className="text-sm text-text-primary">{value ?? "—"}</dd>
    </div>
  );
}

interface Props {
  animalId: number | null;
  onClose:  () => void;
  onFlyTo?: (animalId: number) => void;
  /** Show or hide this animal's trail on the map. */
  onToggleTrail?: (animalId: number) => void;
  trailActive?: boolean;
}

type Loaded =
  | { key: number; state: "ready"; data: AnimalDetail }
  | { key: number; state: "error" };

/** An animal's details: the shared drawer frame, filled with this animal's data. */
export function AnimalDrawer({ animalId, onClose, onFlyTo, onToggleTrail, trailActive = false }: Props) {
  const { offlineThresholdHours } = useTenant();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<DrawerTab>("location");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (animalId === null) return;
    let cancelled = false;
    fetch(`/api/animals/${animalId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: AnimalDetail) => { if (!cancelled) setLoaded({ key: animalId, state: "ready", data }); })
      .catch(() => { if (!cancelled) setLoaded({ key: animalId, state: "error" }); });
    return () => {
      cancelled = true;
    };
  }, [animalId, attempt]);

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((a) => a + 1);
  }, []);

  const mine = animalId !== null && loaded !== null && loaded.key === animalId ? loaded : null;
  const data = mine?.state === "ready" ? mine.data : null;
  const failed = mine?.state === "error";
  const loading = animalId !== null && mine === null;

  return (
    <AnimalDrawerFrame
      open={animalId !== null}
      tagSerial={data?.tag_serial ?? null}
      status={data?.status ?? null}
      onClose={onClose}
      tab={tab}
      onTabChange={setTab}
      miniMap={
        data && data.lat !== null && data.lon !== null ? (
          <MiniMap lat={data.lat} lon={data.lon} status={data.status} label={data.tag_serial ?? ""} />
        ) : (
          <MapPin size={24} strokeWidth={1.5} className="text-text-secondary" aria-hidden />
        )
      }
    >
      {loading && <SkeletonLines rows={5} label="Loading animal" />}
      {failed && <ErrorState what="This animal's details could not be loaded." onRetry={retry} />}

      {data && tab === "location" && (
        <dl className="grid grid-cols-2 gap-4">
          <Field label="Animal" value={data.animal_name ?? "Unnamed"} />
          <Field label="Species" value={`${data.species}${data.sex ? ` · ${data.sex}` : ""}${data.age_years ? ` · ${data.age_years} yr` : ""}`} />
          <Field label="Latitude" value={<span className="font-mono-ids">{data.lat !== null ? formatCoord(data.lat) : "—"}</span>} />
          <Field label="Longitude" value={<span className="font-mono-ids">{data.lon !== null ? formatCoord(data.lon) : "—"}</span>} />
          <div className="col-span-2">
            <Field label="Last fix" value={<Timestamp value={data.last_fix_at} staleAfterHours={offlineThresholdHours} empty="Never" className="text-sm" />} />
          </div>
          <Field label="Geofence" value={data.geofence_name ?? "None assigned"} />
          <Field label="Branch" value={data.branch_name} />
          {(onFlyTo || onToggleTrail) && (
            <div className="col-span-2 flex flex-wrap gap-2">
              {onFlyTo && (
                <Button variant="secondary" onClick={() => onFlyTo(data.id)}>
                  <MapPin size={16} strokeWidth={1.5} aria-hidden /> Show on map
                </Button>
              )}
              {onToggleTrail && (
                <Button variant={trailActive ? "primary" : "secondary"} onClick={() => onToggleTrail(data.id)} aria-pressed={trailActive} data-testid="toggle-trail">
                  <Route size={16} strokeWidth={1.5} aria-hidden /> {trailActive ? "Hide trail" : "Show trail"}
                </Button>
              )}
            </div>
          )}
        </dl>
      )}

      {data && tab === "borrower" && (
        <dl className="grid grid-cols-1 gap-4">
          <Field label="Borrower" value={data.borrower_name} />
          <Field label="CNIC" value={<span className="font-mono-ids">{data.cnic ?? "—"}</span>} />
          <Field label="Phone" value={data.phone} />
          <Field label="Address" value={data.address} />
          <div className="h-px bg-border" />
          <Field label="Loan number" value={<span className="font-mono-ids">{data.loan_number ?? "—"}</span>} />
          <Field label="Amount (PKR)" value={data.amount_pkr ? <span className="tabular-nums">{data.amount_pkr.toLocaleString("en-GB")}</span> : "—"} />
          <Field label="Loan status" value={data.loan_number ? (data.loan_status ?? "active") : "—"} />
        </dl>
      )}

      {data && tab === "tag" && (
        <dl className="grid grid-cols-2 gap-4">
          <Field label="Serial" value={<span className="font-mono-ids">{data.tag_serial ?? "—"}</span>} />
          <Field label="Last seen" value={<Timestamp value={data.last_seen_at} staleAfterHours={offlineThresholdHours} empty="Never" className="text-sm" />} />
          <Field label="Battery" value={<BatteryGlyph pct={data.last_battery_pct} />} />
          <Field label="Signal" value={<SignalGlyph bars={data.last_signal_bars} />} />
          <Field label="Last speed" value={data.last_speed_kmh !== null ? <span className="tabular-nums">{data.last_speed_kmh.toFixed(1)} km/h</span> : "—"} />
          <Field label="Warning buffer" value={data.warning_buffer_m !== null ? <span className="tabular-nums">{data.warning_buffer_m} m</span> : "—"} />
        </dl>
      )}

      {data && tab === "events" && (
        <div className="flex flex-col">
          {data.events.length === 0 && <p className="text-sm text-text-secondary">No events for this animal yet.</p>}
          {data.events.map((ev) => (
            <div key={ev.id} className="border-b border-border py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text-primary">{ev.title}</span>
                <Timestamp value={ev.created_at} />
              </div>
              {ev.detail && <p className="mt-0.5 text-[0.8125rem] leading-[1.125rem] text-text-secondary">{ev.detail}</p>}
              <Pill tone="info" label={ev.status} className="mt-1.5 capitalize" />
            </div>
          ))}
        </div>
      )}
    </AnimalDrawerFrame>
  );
}
