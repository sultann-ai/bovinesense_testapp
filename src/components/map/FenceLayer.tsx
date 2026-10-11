"use client";

import { useEffect, useRef } from "react";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { ringsOf, simplifyRing } from "@/lib/maps/geo";
import { readToken } from "./dom";
import type { FenceFeature } from "./types";

/**
 * Saved geofences (DESIGN.md §6 "Geofences"): a custom polygon or radius fence has a 1.5 px
 * terracotta outline and a 6% terracotta fill; a district fence has a dashed charcoal outline and
 * no fill; a fence with an open breach turns crimson. The selected fence is drawn heavier.
 *
 * Custom fences are drawn through a google.maps.Data layer (solid strokes, fill, click). A district
 * fence is a dashed Polyline per ring, because Data styling cannot dash, with a nearly invisible
 * Data fill so it can still be clicked. The fence being edited is hidden here (terra-draw draws it).
 */
interface Props {
  fences: readonly FenceFeature[];
  selectedId?: number | null;
  /** The fence being edited: drawn by the editor instead. */
  hiddenId?: number | null;
  onSelect?: (fenceId: number) => void;
}

const DISTRICT_SIMPLIFY_DEG = 0.0008;

export function FenceLayer({ fences, selectedId = null, hiddenId = null, onSelect }: Props) {
  const map = useMap();
  const maps = useMapsLibrary("maps");
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    if (!map || !maps) return;

    const brand = readToken("--brand");
    const crimson = readToken("--status-breach");
    const charcoal = readToken("--text-primary");

    const shown = fences.filter((f) => f.id !== hiddenId && f.geometry);
    const custom = shown.filter((f) => f.properties.type !== "district");
    const districts = shown.filter((f) => f.properties.type === "district");

    const disposers: Array<() => void> = [];

    // Custom fences.
    const solid = new maps.Data({
      map,
      style: (feature) => {
        const selected = feature.getProperty("id") === selectedId;
        const color = Number(feature.getProperty("breach_count") ?? 0) > 0 ? crimson : brand;
        return {
          clickable: true,
          strokeColor: color,
          strokeWeight: selected ? 3 : 1.5,
          fillColor: color,
          fillOpacity: selected ? 0.14 : 0.06,
          zIndex: selected ? 4 : 3,
        };
      },
    });
    solid.addGeoJson({ type: "FeatureCollection", features: custom });
    solid.addListener("click", (e: google.maps.Data.MouseEvent) => onSelectRef.current?.(Number(e.feature.getProperty("id"))));
    disposers.push(() => solid.setMap(null));

    // District fences: dashed charcoal, no fill.
    if (districts.length > 0) {
      const hit = new maps.Data({ map, style: { clickable: true, strokeWeight: 0, fillOpacity: 0.001, fillColor: charcoal, zIndex: 1 } });
      hit.addGeoJson({ type: "FeatureCollection", features: districts });
      hit.addListener("click", (e: google.maps.Data.MouseEvent) => onSelectRef.current?.(Number(e.feature.getProperty("id"))));
      disposers.push(() => hit.setMap(null));

      for (const f of districts) {
        const selected = f.id === selectedId;
        const color = f.properties.breach_count > 0 ? crimson : charcoal;
        for (const ring of ringsOf(f.geometry)) {
          const line = new maps.Polyline({
            map,
            path: simplifyRing(ring, DISTRICT_SIMPLIFY_DEG).map(([lon, lat]) => ({ lat, lng: lon })),
            strokeOpacity: 0,
            clickable: false,
            zIndex: selected ? 4 : 2,
            icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: color, strokeWeight: selected ? 3 : 1.5, scale: 2 }, offset: "0", repeat: "12px" }],
          });
          disposers.push(() => line.setMap(null));
        }
      }
    }

    return () => disposers.forEach((d) => d());
  }, [map, maps, fences, selectedId, hiddenId]);

  return null;
}
