"use client";

import { useEffect, useRef } from "react";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { pinVisual, type PinVisual } from "@/lib/maps/status";
import { RefreshableSuperClusterAlgorithm, createClusterRenderer } from "./clusterAlgorithm";
import { createPinElement, updatePinElement } from "./dom";

/**
 * One AdvancedMarkerElement per animal, grouped by @googlemaps/markerclusterer below zoom 10.
 *
 * A cluster is drawn by our own renderer: the count, and if ANY animal inside is in breach, a
 * crimson ring and a badge with the breach count, so a breach can never hide inside a cluster.
 *
 * Markers are created once and updated in place when an animal's position, status or selection
 * changes; the clusterer is only rebuilt when positions or membership change, and only re-rendered
 * (not rebuilt) when a status changes. The clusterer owns each marker's `map` (set while it is
 * unclustered, cleared while it is inside a cluster).
 */
export interface PinData {
  id: number;
  lat: number;
  lon: number;
  status: string;
  tagSerial: string | null;
  animalName: string | null;
  hasUnackBreach: boolean;
}

type AdvancedMarker = google.maps.marker.AdvancedMarkerElement;

interface Item {
  marker: AdvancedMarker;
  content: HTMLElement;
  lat: number;
  lon: number;
  status: string;
}

interface Props {
  pins: readonly PinData[];
  selectedId: number | null;
  onSelect: (animalId: number) => void;
}

/** Marker mutation lives here, outside the component, so the effects below only decide WHAT to do. */
function detach(marker: AdvancedMarker): void {
  marker.map = null;
}

function moveTo(item: Item, lat: number, lon: number): void {
  item.marker.position = { lat, lng: lon };
  item.lat = lat;
  item.lon = lon;
}

function restyle(item: Item, visual: PinVisual): void {
  item.status = visual.status;
  updatePinElement(item.content, visual);
  item.marker.zIndex = visual.zIndex;
  item.marker.title = visual.label;
}

export function AnimalMarkerLayer({ pins, selectedId, onSelect }: Props) {
  const map = useMap();
  const markerLib = useMapsLibrary("marker");

  const state = useRef({
    clusterer: null as MarkerClusterer | null,
    algorithm: null as RefreshableSuperClusterAlgorithm | null,
    items: new Map<number, Item>(),
    statusOf: new WeakMap<object, string>(),
  });
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // The clusterer, with our renderer. Created once the map and the marker library are ready.
  useEffect(() => {
    if (!map || !markerLib) return;
    const s = state.current;

    s.algorithm = new RefreshableSuperClusterAlgorithm();
    s.clusterer = new MarkerClusterer({
      map,
      markers: [],
      algorithm: s.algorithm,
      renderer: createClusterRenderer(markerLib, (m) => s.statusOf.get(m)),
    });

    return () => {
      s.clusterer?.clearMarkers();
      s.clusterer?.setMap(null);
      s.clusterer = null;
      s.algorithm = null;
      for (const item of s.items.values()) detach(item.marker);
      s.items.clear();
    };
  }, [map, markerLib]);

  // Bring the markers in line with the data.
  useEffect(() => {
    const s = state.current;
    const clusterer = s.clusterer;
    if (!map || !markerLib || !clusterer) return;

    let membershipChanged = false;
    let statusChanged = false;
    const seen = new Set<number>();

    for (const p of pins) {
      seen.add(p.id);
      const visual = pinVisual({
        status: p.status,
        hasUnackBreach: p.hasUnackBreach,
        selected: p.id === selectedId,
        tagSerial: p.tagSerial,
        animalName: p.animalName,
      });

      let item = s.items.get(p.id);
      if (!item) {
        const content = createPinElement();
        const marker = new markerLib.AdvancedMarkerElement({
          position: { lat: p.lat, lng: p.lon },
          content,
          title: visual.label,
          zIndex: visual.zIndex,
          gmpClickable: true,
        });
        const select = () => onSelectRef.current(p.id);
        marker.addListener("click", select);
        (marker as unknown as EventTarget).addEventListener("gmp-click", select);
        item = { marker, content, lat: p.lat, lon: p.lon, status: visual.status };
        s.items.set(p.id, item);
        membershipChanged = true;
      } else if (item.lat !== p.lat || item.lon !== p.lon) {
        moveTo(item, p.lat, p.lon);
        membershipChanged = true; // the clusterer must read the new position
      }

      if (item.status !== visual.status) statusChanged = true;
      s.statusOf.set(item.marker, visual.status);
      restyle(item, visual);
    }

    for (const [id, item] of s.items) {
      if (seen.has(id)) continue;
      clusterer.removeMarker(item.marker, true);
      detach(item.marker);
      s.items.delete(id);
      membershipChanged = true;
    }

    if (membershipChanged || statusChanged) {
      // Moved animals must be re-clustered at their new position, and a breach appearing or clearing
      // must reach the cluster badges. A plain render() would do neither: the clusterer skips
      // redrawing when the marker set and zoom are unchanged, so the algorithm is invalidated first.
      s.algorithm?.invalidate();
      clusterer.clearMarkers(true);
      clusterer.addMarkers([...s.items.values()].map((i) => i.marker), true);
      clusterer.render();
    }
  }, [pins, selectedId, map, markerLib]);

  return null;
}
