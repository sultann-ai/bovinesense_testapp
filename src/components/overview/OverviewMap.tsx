"use client";

import { useEffect, useRef, useCallback } from "react";
import { buildMapStyle, STATUS_COLORS, PUNJAB_BOUNDS, PAKISTAN_BOUNDS } from "@/lib/map-style";

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
}

const CLUSTER_MAX_ZOOM = 10;

// Exported so OverviewClient can call imperative flyTo
export type MapHandle = {
  flyToAnimal: (animalId: number, markers: MarkerFeature[]) => void;
};

export function OverviewMap({ markers, selectedAnimalId, onMarkerClick, flyToAnimalId, onFlyToComplete }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<any>(null);
  const markersRef   = useRef(markers);
  markersRef.current = markers;
  const rafRef       = useRef<number>(0);

  // ── Initialise map once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let map: any;
    (async () => {
      const ml  = await import("maplibre-gl");
      await import("maplibre-gl/dist/maplibre-gl.css");

      map = new ml.Map({
        container:          containerRef.current!,
        style:              buildMapStyle(process.env.NEXT_PUBLIC_MAPTILER_KEY ?? ""),
        bounds:             PUNJAB_BOUNDS,
        fitBoundsOptions:   { padding: 40 },
        attributionControl: false,
      });
      mapRef.current = map;

      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");

      map.on("load", async () => {
        // ── Boundaries ──────────────────────────────────────────────────────
        try {
          const geojson = await fetch("/api/boundaries").then((r) => r.json());
          map.addSource("boundaries", { type: "geojson", data: geojson });
          map.addLayer({
            id: "boundaries-line",
            type: "line",
            source: "boundaries",
            paint: {
              "line-color": "#B9AE9C",
              "line-width": 1,
              "line-dasharray": [3, 3],
            },
          });
          // District name labels at zoom 8+
          map.addLayer({
            id: "boundaries-label",
            type: "symbol",
            source: "boundaries",
            minzoom: 8,
            layout: {
              "text-field": ["get", "district_name"],
              "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
              "text-size": 11,
              "text-max-width": 7,
            },
            paint: {
              "text-color": "#6B655C",
              "text-halo-color": "#F3EDE3CC",
              "text-halo-width": 1.5,
            },
          });
        } catch (e) {
          console.warn("Boundaries unavailable:", e);
        }

        // ── Animal sources ───────────────────────────────────────────────────
        const emptyFC = { type: "FeatureCollection", features: [] };

        map.addSource("animals", {
          type:           "geojson",
          data:           emptyFC,
          cluster:        true,
          clusterMaxZoom: CLUSTER_MAX_ZOOM,
          clusterRadius:  50,
          clusterProperties: {
            breach_count: ["+", ["case", ["==", ["get", "status"], "breach"], 1, 0]],
            has_breach:   ["max", ["case", ["==", ["get", "status"], "breach"], 1, 0]],
          },
        });

        // Pulse source (unacknowledged breach animals only)
        map.addSource("breach-pulse", { type: "geojson", data: emptyFC });

        // Selected animal source
        map.addSource("selected", { type: "geojson", data: emptyFC });

        // ── Cluster layers ───────────────────────────────────────────────────
        // Cluster circles
        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "animals",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": [
              "case", [">=", ["get", "breach_count"], 1],
              "#B0172E", "#5C7A6A",
            ],
            "circle-radius": [
              "step", ["get", "point_count"],
              18, 10, 24, 100, 30,
            ],
            "circle-stroke-color": [
              "case", [">=", ["get", "breach_count"], 1],
              "#B0172E", "#3E7C59",
            ],
            "circle-stroke-width": [
              "case", [">=", ["get", "breach_count"], 1], 2.5, 1.5,
            ],
            "circle-stroke-opacity": 0.4,
          },
        });

        // Cluster count text
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "animals",
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 12,
          },
          paint: { "text-color": "#FFFFFF" },
        });

        // Breach badge on clusters
        map.addLayer({
          id: "cluster-breach-badge",
          type: "symbol",
          source: "animals",
          filter: ["all", ["has", "point_count"], [">=", ["get", "breach_count"], 1]],
          layout: {
            "text-field": ["concat", "⚠ ", ["get", "breach_count"]],
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 9,
            "text-offset": [0.8, -0.8],
          },
          paint: { "text-color": "#B0172E" },
        });

        // ── Individual animal layers ─────────────────────────────────────────
        // Pulse ring (behind)
        map.addLayer({
          id: "breach-pulse-ring",
          type: "circle",
          source: "breach-pulse",
          paint: {
            "circle-radius": 28,
            "circle-color": "#B0172E",
            "circle-opacity": 0.3,
          },
        });

        // Main circle
        map.addLayer({
          id: "animal-circle",
          type: "circle",
          source: "animals",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": 14,
            "circle-color": [
              "match", ["get", "status"],
              "inside", "#3E7C59",
              "near",   "#B7791F",
              "breach", "#B0172E",
              "fast",   "#6D3FA8",
              "stale",  "#7A7F87",
              "#7A7F87",
            ],
            "circle-stroke-color": "#FFFFFF",
            "circle-stroke-width": 2,
            "circle-opacity": ["case", ["==", ["get", "status"], "stale"], 0.6, 1],
          },
        });

        // Stale clock indicator (darker outline)
        map.addLayer({
          id: "animal-stale-ring",
          type: "circle",
          source: "animals",
          filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "status"], "stale"]],
          paint: {
            "circle-radius": 16,
            "circle-color": "transparent",
            "circle-stroke-color": "#7A7F87",
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": 0.5,
          },
        });

        // Selected gold ring (on top)
        map.addLayer({
          id: "animal-selected",
          type: "circle",
          source: "selected",
          paint: {
            "circle-radius": 20,
            "circle-color": "transparent",
            "circle-stroke-color": "#D9A441",
            "circle-stroke-width": 3,
          },
        });

        // ── Click handlers ───────────────────────────────────────────────────
        map.on("click", "animal-circle", (e: any) => {
          const f = e.features[0];
          if (f) onMarkerClick(f.properties.id);
        });

        map.on("click", "clusters", (e: any) => {
          const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
          const clusterId = features[0].properties.cluster_id;
          map.getSource("animals").getClusterExpansionZoom(clusterId, (_err: any, zoom: number) => {
            map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom + 1 });
          });
        });

        map.on("mouseenter", "animal-circle", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "animal-circle", () => { map.getCanvas().style.cursor = ""; });
        map.on("mouseenter", "clusters",      () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "clusters",      () => { map.getCanvas().style.cursor = ""; });

        // Populate initial data
        updateMapData(map, markersRef.current, null);

        // Pulse animation
        startPulse(map);
      });
    })();

    return () => {
      cancelAnimationFrame(rafRef.current);
      map?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update markers when data changes ──────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getSource("animals")) return;
    updateMapData(map, markers, selectedAnimalId);
  }, [markers, selectedAnimalId]);

  // ── Fly to animal ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!flyToAnimalId) return;
    const m = markers.find((f) => f.properties.id === flyToAnimalId);
    if (m && mapRef.current) {
      mapRef.current.flyTo({ center: m.geometry.coordinates, zoom: 13, duration: 1000 });
    }
    onFlyToComplete?.();
  }, [flyToAnimalId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pulse RAF ─────────────────────────────────────────────────────────────
  function startPulse(map: any) {
    // Respect prefers-reduced-motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let phase = 0;
    function animate() {
      phase += 0.04;
      const r = 16 + 8 * Math.abs(Math.sin(phase));
      const o = 0.15 + 0.2 * Math.abs(Math.sin(phase));
      try {
        if (map.getLayer("breach-pulse-ring")) {
          map.setPaintProperty("breach-pulse-ring", "circle-radius", r);
          map.setPaintProperty("breach-pulse-ring", "circle-opacity", o);
        }
      } catch { /* layer removed */ }
      rafRef.current = requestAnimationFrame(animate);
    }
    rafRef.current = requestAnimationFrame(animate);
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Map canvas */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* Map control buttons */}
      <div
        className="absolute top-3 left-3 z-10 flex gap-2"
      >
        {(["Punjab", "Pakistan", "Fit"] as const).map((label) => (
          <button
            key={label}
            onClick={() => {
              const map = mapRef.current;
              if (!map) return;
              if (label === "Punjab")   map.fitBounds(PUNJAB_BOUNDS, { padding: 40, duration: 800 });
              if (label === "Pakistan") map.fitBounds(PAKISTAN_BOUNDS, { padding: 40, duration: 800 });
              if (label === "Fit") {
                const ms = markersRef.current;
                if (!ms.length) return;
                const lngs = ms.map((f) => f.geometry.coordinates[0]);
                const lats = ms.map((f) => f.geometry.coordinates[1]);
                map.fitBounds(
                  [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
                  { padding: 60, duration: 800 },
                );
              }
            }}
            className="rounded px-3 py-1.5 text-xs font-medium shadow-float transition-colors"
            style={{
              backgroundColor: "var(--bg-surface)",
              color:           "var(--text-primary)",
              border:          "1px solid var(--border)",
              boxShadow:       "var(--shadow-float)",
            }}
          >
            {label === "Fit" ? "Fit to all" : label}
          </button>
        ))}

        <button
          onClick={() => {
            const map = mapRef.current;
            if (!map) return;
            const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
            const isSat = (map as any)._satMode;
            (map as any)._satMode = !isSat;
            map.setStyle(
              isSat
                ? buildMapStyle(key ?? "")
                : key
                ? `https://api.maptiler.com/maps/satellite/style.json?key=${key}`
                : buildMapStyle(""),
            );
          }}
          className="rounded px-3 py-1.5 text-xs font-medium transition-colors"
          style={{
            backgroundColor: "var(--bg-surface)",
            color:           "var(--text-primary)",
            border:          "1px solid var(--border)",
            boxShadow:       "var(--shadow-float)",
          }}
        >
          Satellite
        </button>
      </div>

      {/* Legend */}
      <div
        className="absolute bottom-4 left-3 z-10 rounded-[10px] p-3"
        style={{
          backgroundColor: "var(--bg-surface)",
          border:          "1px solid var(--border)",
          boxShadow:       "var(--shadow-float)",
          minWidth:        "130px",
        }}
      >
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.04em] text-text-secondary">
          Status
        </p>
        {Object.entries(STATUS_COLORS).map(([key, color]) => (
          <div key={key} className="flex items-center gap-2 mb-1 last:mb-0">
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-[11px] capitalize text-text-secondary">
              {key === "stale" ? "Offline" : key}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function updateMapData(
  map:              any,
  markers:          MarkerFeature[],
  selectedAnimalId: number | null,
) {
  const fc = { type: "FeatureCollection", features: markers };

  const animalsSource = map.getSource("animals");
  if (animalsSource) animalsSource.setData(fc);

  const pulseSrc = map.getSource("breach-pulse");
  if (pulseSrc) {
    pulseSrc.setData({
      type: "FeatureCollection",
      features: markers.filter(
        (f) => f.properties.status === "breach" && f.properties.has_unack_breach,
      ),
    });
  }

  const selSrc = map.getSource("selected");
  if (selSrc) {
    const sel = selectedAnimalId
      ? markers.filter((f) => f.properties.id === selectedAnimalId)
      : [];
    selSrc.setData({ type: "FeatureCollection", features: sel });
  }
}
