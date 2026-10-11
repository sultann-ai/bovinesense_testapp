"use client";

import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";

/** Centre the map on a position (from search, the Animals page "Locate", or a toast's "View"). */
export const FLY_TO_ZOOM = 13;

export function FlyToAnimal({
  target,
  onDone,
}: {
  target: { lat: number; lng: number } | null;
  onDone?: () => void;
}) {
  const map = useMap();
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (!map || !target) return;
    map.panTo(target);
    map.setZoom(FLY_TO_ZOOM);
    onDoneRef.current?.();
  }, [map, target]);

  return null;
}
