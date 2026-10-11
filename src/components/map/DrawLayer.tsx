"use client";

import { useEffect, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { TerraDraw } from "terra-draw";
import { readToken } from "./dom";
import type { Hex } from "./drawModes";
import type { DrawnFeature } from "@/lib/maps/fences";

/**
 * Drawing and editing geofence shapes with terra-draw's Google Maps adapter.
 *
 *   off       nothing drawn
 *   polygon   click to add corners, double-click to close
 *   circle    click the centre, move, click to set the radius
 *   edit      `feature` is loaded and can be reshaped: drag corners or add them at the midpoints
 *             (polygon), or drag it and resize it (circle)
 *   preview   `feature` is shown, not editable (a radius typed in as numbers)
 *
 * After a shape is drawn it stays selected so its corners can still be adjusted; every change is
 * reported (onDrawn once, onEdited for each adjustment) as a plain GeoJSON feature. Turning a shape
 * into the request that saves it is src/lib/maps/fences.ts; the database validates it.
 */
export type DrawMode = "off" | "polygon" | "circle" | "edit" | "preview";

interface Props {
  mode: DrawMode;
  /** The shape to load for "edit" and "preview". */
  feature?: { type: "Feature"; geometry: unknown; properties: Record<string, unknown> } | null;
  onDrawn?: (feature: DrawnFeature) => void;
  onEdited?: (feature: DrawnFeature) => void;
  /** Change this to start over in the same mode (a "Redo"). */
  resetKey?: number;
}

/** What a finished edit reports in terra-draw's context. */
const DRAW_ACTION = "draw";

export function DrawLayer({ mode, feature = null, onDrawn, onEdited, resetKey = 0 }: Props) {
  const map = useMap();
  const drawRef = useRef<TerraDraw | null>(null);
  const [ready, setReady] = useState(false);
  const onDrawnRef = useRef(onDrawn);
  const onEditedRef = useRef(onEdited);
  useEffect(() => {
    onDrawnRef.current = onDrawn;
    onEditedRef.current = onEdited;
  });

  // Start terra-draw once the map exists. (Loaded on demand: it is only needed when drawing.)
  useEffect(() => {
    if (!map) return;
    let disposed = false;
    let draw: TerraDraw | null = null;

    (async () => {
      const { TerraDraw } = await import("terra-draw");
      const { TerraDrawGoogleMapsAdapter } = await import("terra-draw-google-maps-adapter");
      const { buildDrawModes } = await import("./drawModes");
      if (disposed) return;

      // terra-draw wants literal colours: read them from the design tokens.
      const modes = buildDrawModes({
        brand: readToken("--brand") as Hex,
        highlight: readToken("--highlight") as Hex,
        charcoal: readToken("--text-primary") as Hex,
      });

      draw = new TerraDraw({
        adapter: new TerraDrawGoogleMapsAdapter({ lib: google.maps, map, coordinatePrecision: 9 }),
        modes,
      });
      draw.start();

      draw.on("finish", (id, context) => {
        const d = drawRef.current;
        const f = d?.getSnapshotFeature(id);
        if (!d || !f) return;
        const shape = f as unknown as DrawnFeature;
        if (context.action === DRAW_ACTION) {
          onDrawnRef.current?.(shape);
          // Keep it selected so the corners can still be adjusted before saving.
          d.setMode("select");
          d.selectFeature(id);
        } else {
          onEditedRef.current?.(shape);
        }
      });

      drawRef.current = draw;
      setReady(true);
    })().catch((err) => console.error("[map] drawing tools could not start", err));

    return () => {
      disposed = true;
      setReady(false);
      drawRef.current = null;
      try {
        draw?.stop();
      } catch {
        /* already stopped */
      }
    };
  }, [map]);

  // Follow the requested mode.
  useEffect(() => {
    const draw = drawRef.current;
    if (!ready || !draw) return;
    try {
      draw.clear();
      if (mode === "polygon" || mode === "circle") {
        draw.setMode(mode);
      } else if ((mode === "edit" || mode === "preview") && feature) {
        const [added] = draw.addFeatures([feature as never]);
        if (added && added.valid === false) console.warn("[map] the shape could not be loaded:", added.reason);
        const loaded = draw.getSnapshot()[0];
        if (mode === "edit" && loaded) {
          draw.setMode("select");
          draw.selectFeature(loaded.id as string | number);
        } else {
          draw.setMode("static");
        }
      } else {
        draw.setMode("static");
      }
    } catch (err) {
      console.error("[map] drawing mode failed", err);
    }
  }, [ready, mode, feature, resetKey]);

  return null;
}
