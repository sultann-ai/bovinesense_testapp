"use client";

import { useEffect, useState } from "react";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { boundsOfGeometry, centerOfBounds, ringsOf, simplifyRing, type PolygonalGeometry } from "@/lib/maps/geo";
import { createDistrictLabel, readToken } from "./dom";

/**
 * District boundaries from PostGIS (/api/boundaries, GeoJSON), faint and dashed (--map-boundary, 1 px,
 * DESIGN.md §3), labelled from zoom 8.
 *
 * The geometry is loaded into a google.maps.Data layer, which also gives each district a faint
 * hover highlight. The Data layer cannot draw dashed strokes, so the visible dashed outline is a
 * Polyline per ring using a repeating symbol; the rings are simplified first (about 90 m) so a
 * detailed boundary stays cheap to draw.
 */
interface Feature {
  properties?: { district_name?: string | null } | null;
  geometry?: PolygonalGeometry | null;
}

/** Roughly 90 m: invisible at district scale, large savings in vertices. */
const SIMPLIFY_TOLERANCE_DEG = 0.0008;
const LABEL_MIN_ZOOM = 8;

export function BoundaryLayer() {
  const map = useMap();
  const maps = useMapsLibrary("maps");
  const markerLib = useMapsLibrary("marker");
  const [features, setFeatures] = useState<Feature[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/boundaries")
      .then((r) => (r.ok ? r.json() : null))
      .then((fc) => {
        if (!cancelled && fc && Array.isArray(fc.features)) setFeatures(fc.features as Feature[]);
      })
      .catch(() => { /* the map is useful without boundaries */ });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!map || !maps || !markerLib || features.length === 0) return;

    const color = readToken("--map-boundary");

    // Geometry and hover, in a Data layer.
    const data = new maps.Data({ map, style: { clickable: true, strokeWeight: 0, fillOpacity: 0, zIndex: 1 } });
    data.addGeoJson({ type: "FeatureCollection", features });
    data.addListener("mouseover", (e: google.maps.Data.MouseEvent) =>
      data.overrideStyle(e.feature, { fillColor: color, fillOpacity: 0.1 }),
    );
    data.addListener("mouseout", (e: google.maps.Data.MouseEvent) => data.revertStyle(e.feature));

    // The visible dashed outline.
    const lines: google.maps.Polyline[] = [];
    const labels: google.maps.marker.AdvancedMarkerElement[] = [];
    for (const f of features) {
      for (const ring of ringsOf(f.geometry)) {
        lines.push(
          new maps.Polyline({
            map,
            path: simplifyRing(ring, SIMPLIFY_TOLERANCE_DEG).map(([lon, lat]) => ({ lat, lng: lon })),
            strokeOpacity: 0,
            clickable: false,
            zIndex: 2,
            icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: color, strokeWeight: 1, scale: 2 }, offset: "0", repeat: "10px" }],
          }),
        );
      }
      const name = f.properties?.district_name;
      const b = boundsOfGeometry(f.geometry);
      if (name && b) {
        const [lon, lat] = centerOfBounds(b);
        labels.push(new markerLib.AdvancedMarkerElement({ position: { lat, lng: lon }, content: createDistrictLabel(name), zIndex: 1, gmpClickable: false }));
      }
    }

    // District names from zoom 8.
    const syncLabels = () => {
      const show = (map.getZoom() ?? 0) >= LABEL_MIN_ZOOM;
      for (const m of labels) m.map = show ? map : null;
    };
    const zoomListener = map.addListener("zoom_changed", syncLabels);
    syncLabels();

    return () => {
      zoomListener.remove();
      data.setMap(null);
      for (const l of lines) l.setMap(null);
      for (const m of labels) m.map = null;
    };
  }, [map, maps, markerLib, features]);

  return null;
}
