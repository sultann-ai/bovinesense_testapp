"use client";

import { useMemo, useState } from "react";
import { GoogleMapsProvider } from "@/components/map/GoogleMapsProvider";
import { MapCanvas } from "@/components/map/MapCanvas";
import { MapControls, StatusLegend } from "@/components/map/MapControls";
import { AnimalMarkerLayer, type PinData } from "@/components/map/AnimalMarkerLayer";
import { BoundaryLayer } from "@/components/map/BoundaryLayer";
import { FlyToAnimal } from "@/components/map/FlyToAnimal";
import { TrailLayer } from "@/components/map/TrailLayer";
import { TrailPanel } from "@/components/map/TrailPanel";
import { useTrail } from "@/components/map/useTrail";
import type { Position } from "@/lib/maps/geo";
import type { TrailHours } from "@/lib/maps/trail";
import { MapPopup } from "@/components/ui/map-popup";
import { useTenant } from "@/components/shell/TenantProvider";

export interface MarkerFeature {
  type: "Feature";
  id: number;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id:              number;
    animal_name:     string;
    status:          string;
    tag_serial:      string;
    borrower_name:   string;
    loan_number:     string;
    fixed_at:        string;
    battery_pct:     number | null;
    has_unack_breach: boolean;
  };
}

interface Props {
  markers:          MarkerFeature[];
  selectedAnimalId: number | null;
  onMarkerClick:    (animalId: number) => void;
  flyToAnimalId:    number | null;
  onFlyToComplete?: () => void;
  /** The animal whose trail is shown, if any, and its window. */
  trailAnimalId:    number | null;
  trailHours:       TrailHours;
  onTrailHoursChange: (hours: TrailHours) => void;
  onTrailClose:     () => void;
  /** The animal whose popup is open (a clicked pin), and what its buttons do. */
  popupAnimalId:    number | null;
  onOpenDetails:    (animalId: number) => void;
  onClosePopup:     () => void;
}

/**
 * The Overview map (Google Maps, the BovineSense style): district boundaries, an animal pin per
 * animal (clustered below zoom 10, breaches never hidden), the selected animal's trail with
 * playback, and the view buttons. The map itself, the key and the Map ID are in src/components/map.
 */
export function OverviewMap({
  markers, selectedAnimalId, onMarkerClick, flyToAnimalId, onFlyToComplete,
  trailAnimalId, trailHours, onTrailHoursChange, onTrailClose,
  popupAnimalId, onOpenDetails, onClosePopup,
}: Props) {
  const { offlineThresholdHours } = useTenant();
  const [satellite, setSatellite] = useState(false);
  const trail = useTrail(trailAnimalId, trailHours);

  const pins = useMemo<PinData[]>(
    () =>
      markers.map((f) => ({
        id: f.properties.id,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        status: f.properties.status,
        tagSerial: f.properties.tag_serial,
        animalName: f.properties.animal_name,
        hasUnackBreach: f.properties.has_unack_breach,
      })),
    [markers],
  );
  const positions = useMemo(() => markers.map((f): Position => f.geometry.coordinates), [markers]);

  const flyTarget = useMemo(() => {
    const m = flyToAnimalId === null ? undefined : markers.find((f) => f.properties.id === flyToAnimalId);
    return m ? { lat: m.geometry.coordinates[1], lng: m.geometry.coordinates[0] } : null;
  }, [flyToAnimalId, markers]);

  const popupAnimal = popupAnimalId === null ? undefined : markers.find((f) => f.properties.id === popupAnimalId);

  return (
    <div className="relative flex-1 overflow-hidden">
      <GoogleMapsProvider>
        <MapCanvas satellite={satellite}>
          <BoundaryLayer />
          <AnimalMarkerLayer pins={pins} selectedId={selectedAnimalId} onSelect={onMarkerClick} />
          {trailAnimalId !== null && trail.status === "ready" && <TrailLayer points={trail.points} index={trail.index} />}
          <FlyToAnimal target={flyTarget} onDone={onFlyToComplete} />
        </MapCanvas>

        <MapControls satellite={satellite} onToggleSatellite={() => setSatellite((s) => !s)} positions={positions} />
        <StatusLegend />
        {trailAnimalId !== null && (
          <TrailPanel trail={trail} hours={trailHours} onHoursChange={onTrailHoursChange} onClose={onTrailClose} />
        )}
      </GoogleMapsProvider>

      {/* Outside the map's error boundary: the popup does not depend on Google. */}
      {popupAnimal && (
        <div className="absolute bottom-4 right-3 z-20">
          <MapPopup
            animal={{
              tagSerial: popupAnimal.properties.tag_serial,
              animalName: popupAnimal.properties.animal_name,
              borrowerName: popupAnimal.properties.borrower_name,
              lastFixAt: popupAnimal.properties.fixed_at,
              status: popupAnimal.properties.status,
            }}
            staleAfterHours={offlineThresholdHours}
            onOpenDetails={() => onOpenDetails(popupAnimal.properties.id)}
            onClose={onClosePopup}
          />
        </div>
      )}
    </div>
  );
}
