"use client";

import { useEffect } from "react";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { pinVisual } from "@/lib/maps/status";
import { GoogleMapsProvider } from "./GoogleMapsProvider";
import { MapCanvas } from "./MapCanvas";
import { createPinElement, updatePinElement } from "./dom";

/**
 * The still map in the animal drawer: the BovineSense style, the animal's pin, nothing to drag.
 * Each mini map is one more Google map load (see the README, "Google Maps: cost and key").
 */
function Pin({ lat, lon, status, label }: { lat: number; lon: number; status: string; label: string }) {
  const map = useMap();
  const markerLib = useMapsLibrary("marker");

  useEffect(() => {
    if (!map || !markerLib) return;
    const content = createPinElement();
    updatePinElement(content, pinVisual({ status, hasUnackBreach: false, selected: false, tagSerial: label }));
    const marker = new markerLib.AdvancedMarkerElement({ map, position: { lat, lng: lon }, content, gmpClickable: false });
    return () => {
      marker.map = null;
    };
  }, [map, markerLib, lat, lon, status, label]);

  return null;
}

export function MiniMap({ lat, lon, status, label }: { lat: number; lon: number; status: string; label: string }) {
  return (
    <div className="relative h-full w-full" data-testid="mini-map">
      <GoogleMapsProvider quiet>
        <MapCanvas still center={{ lat, lng: lon }} zoom={13}>
          <Pin lat={lat} lon={lon} status={status} label={label} />
        </MapCanvas>
      </GoogleMapsProvider>
    </div>
  );
}
