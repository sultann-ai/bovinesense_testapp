"use client";

import { useCallback, useRef } from "react";
import { Map, type MapCameraChangedEvent } from "@vis.gl/react-google-maps";
import { useMapId } from "./GoogleMapsProvider";
import { useMapConfig } from "./MapConfigContext";
import type { Bounds } from "@/lib/maps/regions";

/**
 * The map itself: the BovineSense cloud style (through the Map ID), opening fitted to the tenant's
 * service area, and never able to show the whole world (the camera is restricted to the country
 * plus a margin, and cannot zoom out past it).
 *
 * Our own buttons replace Google's controls (see MapControls); only the zoom control stays.
 * The current zoom and bounds are mirrored onto data- attributes of the wrapper, which is how the
 * browser tests (and anyone debugging) can read what the camera is doing.
 */
interface Props {
  /** Satellite instead of the styled roadmap. */
  satellite?: boolean;
  /** Where to open; defaults to the tenant's service area. */
  bounds?: Bounds;
  /** A still, non-interactive map (the drawer's mini map). */
  still?: boolean;
  /** Open here instead of fitting `bounds`. */
  center?: { lat: number; lng: number };
  zoom?: number;
  children?: React.ReactNode;
}

export function MapCanvas({ satellite = false, bounds, still = false, center, zoom, children }: Props) {
  const mapId = useMapId();
  const { serviceArea, limit } = useMapConfig();
  const wrapper = useRef<HTMLDivElement>(null);

  const onCameraChanged = useCallback((ev: MapCameraChangedEvent) => {
    const el = wrapper.current;
    if (!el) return;
    const { zoom: z, bounds: b } = ev.detail;
    el.dataset.mapZoom = String(Math.round(z * 100) / 100);
    el.dataset.mapBounds = [b.south, b.west, b.north, b.east].map((n) => n.toFixed(3)).join(",");
  }, []);

  const open = bounds ?? serviceArea.bounds;
  const openAt = center ? { defaultCenter: center, defaultZoom: zoom ?? 13 } : { defaultBounds: { ...open, padding: 40 } };

  return (
    <div ref={wrapper} data-testid="google-map" className="absolute inset-0">
      <Map
        mapId={mapId}
        {...openAt}
        mapTypeId={satellite ? "hybrid" : "roadmap"}
        gestureHandling={still ? "none" : "greedy"}
        disableDefaultUI
        zoomControl={!still}
        keyboardShortcuts={!still}
        clickableIcons={false}
        // No world view: the camera cannot leave the country (plus a margin) or zoom out past it.
        restriction={{ latLngBounds: limit, strictBounds: true }}
        minZoom={4}
        onCameraChanged={onCameraChanged}
        style={{ width: "100%", height: "100%" }}
      >
        {children}
      </Map>
    </div>
  );
}
