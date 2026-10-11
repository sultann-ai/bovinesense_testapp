"use client";

import { useEffect, useRef } from "react";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { padBounds } from "@/lib/maps/geo";
import { trailBounds, trailPath, type TrailPoint } from "@/lib/maps/trail";
import { formatAbsoluteTime } from "@/lib/format";
import { createTrailDot, createTrailHead, readToken } from "./dom";

/**
 * The trail on the map (DESIGN.md §6): a 2 px charcoal line, a dot per fix (hover shows the time
 * and speed), and the playhead. Dots the playhead has not reached are dimmed. The line connects the
 * dots, but the dots are the data: the gaps between fixes are real.
 */
interface Props {
  points: readonly TrailPoint[];
  /** Index of the fix the playhead is on. */
  index: number;
}

function dotTitle(p: TrailPoint): string {
  const speed = p.speedKmh === null ? "" : ` · ${p.speedKmh.toFixed(1)} km/h`;
  return `${formatAbsoluteTime(p.fixedAt)}${speed}`;
}

export function TrailLayer({ points, index }: Props) {
  const map = useMap();
  const maps = useMapsLibrary("maps");
  const markerLib = useMapsLibrary("marker");
  const dots = useRef<HTMLElement[]>([]);
  const head = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);

  // Draw the trail when it changes, and fit the map to it.
  useEffect(() => {
    if (!map || !maps || !markerLib || points.length === 0) return;

    const line = new maps.Polyline({
      map,
      path: trailPath(points),
      strokeColor: readToken("--text-primary"),
      strokeOpacity: 1,
      strokeWeight: 2,
      clickable: false,
      zIndex: 20,
    });

    const markers = points.map((p, i) => {
      const content = createTrailDot(true, dotTitle(p));
      dots.current[i] = content;
      return new markerLib.AdvancedMarkerElement({ map, position: { lat: p.lat, lng: p.lon }, content, zIndex: 21, gmpClickable: false });
    });

    const playhead = new markerLib.AdvancedMarkerElement({
      map,
      position: { lat: points[points.length - 1].lat, lng: points[points.length - 1].lon },
      content: createTrailHead(),
      zIndex: 22,
      gmpClickable: false,
    });
    head.current = playhead;

    const b = trailBounds(points);
    if (b) map.fitBounds(padBounds(b, 0.15, 0.01), 60);

    return () => {
      line.setMap(null);
      for (const m of markers) m.map = null;
      playhead.map = null;
      head.current = null;
      dots.current = [];
    };
  }, [map, maps, markerLib, points]);

  // Move the playhead and dim the dots it has not reached.
  useEffect(() => {
    const p = points[index];
    if (head.current && p) head.current.position = { lat: p.lat, lng: p.lon };
    dots.current.forEach((dot, i) => {
      dot.dataset.passed = String(i <= index);
    });
  }, [points, index]);

  return null;
}
