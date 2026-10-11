"use client";

import { useMap } from "@vis.gl/react-google-maps";
import { ANIMAL_STATUSES, STATUS_LABELS } from "@/lib/maps/status";
import { boundsOfPositions, padBounds, type Position } from "@/lib/maps/geo";
import type { Bounds } from "@/lib/maps/regions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useMapConfig } from "./MapConfigContext";

/**
 * Floating controls (DESIGN.md §6): the service area, the country, "Fit to all animals" and the
 * satellite toggle, top left; the status legend, bottom left. There is deliberately no "world".
 */

interface Props {
  satellite: boolean;
  onToggleSatellite: () => void;
  /** Where every animal is (lon, lat), for "Fit to all animals". */
  positions: readonly Position[];
}

export function MapControls({ satellite, onToggleSatellite, positions }: Props) {
  const map = useMap();
  const { serviceArea, country } = useMapConfig();

  const fit = (b: Bounds) => map?.fitBounds(b, 40);
  const fitAll = () => {
    const b = boundsOfPositions(positions);
    if (b) map?.fitBounds(padBounds(b, 0.08, 0.02), 60);
  };

  // Floating over the map: surface fill, hairline border, the one allowed shadow.
  const float = "border-border bg-bg-surface shadow-[var(--shadow-float)]";

  return (
    <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2" role="group" aria-label="Map view">
      <Button variant="secondary" className={float} onClick={() => fit(serviceArea.bounds)} data-testid="fit-service-area">
        {serviceArea.label}
      </Button>
      <Button variant="secondary" className={float} onClick={() => fit(country.bounds)} data-testid="fit-country">
        {country.label}
      </Button>
      <Button variant="secondary" className={float} onClick={fitAll} disabled={positions.length === 0} data-testid="fit-all">
        Fit to all animals
      </Button>
      <Button variant="secondary" className={cn(float, satellite && "bg-brand-tint text-brand-hover")} onClick={onToggleSatellite} aria-pressed={satellite} data-pressed={satellite} data-testid="satellite-toggle">
        Satellite
      </Button>
    </div>
  );
}

export function StatusLegend() {
  return (
    <div
      className="absolute bottom-4 left-3 z-10 min-w-[130px] rounded-[var(--radius-md)] border border-border bg-bg-surface p-3 text-text-primary shadow-[var(--shadow-float)]"
      aria-label="Map legend"
    >
      <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.04em] text-text-secondary">Status</p>
      {ANIMAL_STATUSES.map((status) => (
        <div key={status} className="mb-1 flex items-center gap-2 last:mb-0">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `var(--status-${status})` }} />
          <span className="text-[11px] text-text-secondary">{STATUS_LABELS[status]}</span>
        </div>
      ))}
    </div>
  );
}
