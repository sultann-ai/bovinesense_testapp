"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PLAYBACK_INTERVAL_MS, clampIndex, nextPlaybackIndex, parseTrail, pointAt,
  type TrailHours, type TrailPoint,
} from "@/lib/maps/trail";

/**
 * The trail of one animal over a window, and the playback state (which fix the playhead is on,
 * whether it is playing). Loads /api/animals/:id/trail?hours=. Playback steps from fix to fix
 * (never between them: the gaps are real) and stops after the newest.
 *
 * State is keyed by animal and window, so changing either starts clean without an effect that
 * resets state.
 */
export type TrailStatus = "idle" | "loading" | "ready" | "error";

export interface TrailState {
  status: TrailStatus;
  points: TrailPoint[];
  index: number;
  current: TrailPoint | null;
  playing: boolean;
  setIndex: (index: number) => void;
  togglePlay: () => void;
}

export function useTrail(animalId: number | null, hours: TrailHours): TrailState {
  const key = animalId === null ? null : `${animalId}:${hours}`;

  const [loaded, setLoaded] = useState<{ key: string; ok: boolean; points: TrailPoint[] } | null>(null);
  const [playhead, setPlayhead] = useState<{ key: string | null; index: number; playing: boolean }>({ key: null, index: 0, playing: false });

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    fetch(`/api/animals/${animalId}/trail?hours=${hours}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((fc) => { if (!cancelled) setLoaded({ key, ok: true, points: parseTrail(fc) }); })
      .catch(() => { if (!cancelled) setLoaded({ key, ok: false, points: [] }); });
    return () => {
      cancelled = true;
    };
  }, [key, animalId, hours]);

  const mine = loaded !== null && loaded.key === key ? loaded : null;
  const status: TrailStatus = key === null ? "idle" : mine === null ? "loading" : mine.ok ? "ready" : "error";
  const points = mine?.points ?? [];

  // Until the person moves the playhead it rests on the newest fix (where the animal is now).
  const ph = playhead.key === key ? playhead : { key, index: Math.max(points.length - 1, 0), playing: false };
  const index = clampIndex(playhead.key === key ? playhead.index : points.length - 1, points.length);

  const setIndex = useCallback((i: number) => setPlayhead({ key, index: clampIndex(i, points.length), playing: false }), [key, points.length]);

  const togglePlay = useCallback(() => {
    setPlayhead((p) => {
      const base = p.key === key ? p : { key, index: Math.max(points.length - 1, 0), playing: false };
      if (base.playing) return { ...base, playing: false };
      // Playing from the newest fix restarts at the oldest.
      return { key, index: base.index >= points.length - 1 ? 0 : base.index, playing: points.length > 1 };
    });
  }, [key, points.length]);

  const playing = ph.playing;
  useEffect(() => {
    if (!playing || key === null) return;
    const timer = setInterval(() => {
      setPlayhead((p) => {
        if (p.key !== key || !p.playing) return p;
        const next = nextPlaybackIndex(p.index, points.length);
        return next === null ? { ...p, playing: false } : { ...p, index: next };
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [playing, key, points.length]);

  return { status, points, index, current: pointAt(points, index), playing, setIndex, togglePlay };
}
