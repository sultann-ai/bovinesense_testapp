"use client";

import { useEffect } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { GoogleMapsProvider } from "./GoogleMapsProvider";
import { MapCanvas } from "./MapCanvas";
import { BoundaryLayer } from "./BoundaryLayer";
import { FenceLayer } from "./FenceLayer";
import { DrawLayer, type DrawMode } from "./DrawLayer";
import type { FenceFeature } from "./types";
import { boundsOfGeometry, padBounds } from "@/lib/maps/geo";
import type { DrawnFeature } from "@/lib/maps/fences";

/**
 * The map of the Geofences screen and of the "New geofence" dialog: district boundaries, the saved
 * fences, and the drawing tools. Drawing and editing are terra-draw on Google Maps (see DrawLayer);
 * what they produce is saved as PostGIS geometry by the geofence API.
 */
interface Props {
  fences: readonly FenceFeature[];
  selectedId?: number | null;
  /** The fence being edited (drawn by the editor, so not drawn twice). */
  hiddenId?: number | null;
  onSelectFence?: (fenceId: number) => void;
  /** Bring this fence into view. */
  fitFenceId?: number | null;
  drawMode?: DrawMode;
  drawFeature?: { type: "Feature"; geometry: unknown; properties: Record<string, unknown> } | null;
  onDrawn?: (feature: DrawnFeature) => void;
  onEdited?: (feature: DrawnFeature) => void;
  resetKey?: number;
}

function FitToFence({ fences, fenceId }: { fences: readonly FenceFeature[]; fenceId: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || fenceId === null) return;
    const fence = fences.find((f) => f.id === fenceId);
    const b = fence?.geometry ? boundsOfGeometry(fence.geometry) : null;
    if (b) map.fitBounds(padBounds(b, 0.25, 0.005), 60);
    // Only when the requested fence changes, not whenever the list reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fenceId]);
  return null;
}

export function GeofenceMapView({
  fences, selectedId = null, hiddenId = null, onSelectFence, fitFenceId = null,
  drawMode = "off", drawFeature = null, onDrawn, onEdited, resetKey = 0,
}: Props) {
  return (
    <GoogleMapsProvider>
      <MapCanvas>
        <BoundaryLayer />
        <FenceLayer fences={fences} selectedId={selectedId} hiddenId={hiddenId} onSelect={onSelectFence} />
        <DrawLayer mode={drawMode} feature={drawFeature} onDrawn={onDrawn} onEdited={onEdited} resetKey={resetKey} />
        <FitToFence fences={fences} fenceId={fitFenceId} />
      </MapCanvas>
    </GoogleMapsProvider>
  );
}
