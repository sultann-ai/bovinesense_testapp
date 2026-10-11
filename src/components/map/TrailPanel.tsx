"use client";

import { Pause, Play, X } from "lucide-react";
import { TRAIL_WINDOWS, gapMinutes, positionLabel, type TrailHours } from "@/lib/maps/trail";
import { formatAbsoluteTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/filter-bar";
import type { TrailState } from "./useTrail";

/**
 * The trail controls, floating over the map: 24 h / 7 days, a slider that scrubs through the fixes,
 * play/pause, and a readout of the fix under the playhead. Playback steps fix to fix; the readout
 * also says how long the gap since the previous fix was, because the gaps are real.
 */
interface Props {
  trail: TrailState;
  hours: TrailHours;
  onHoursChange: (hours: TrailHours) => void;
  onClose: () => void;
}

export function TrailPanel({ trail, hours, onHoursChange, onClose }: Props) {
  const { status, points, index, current, playing, setIndex, togglePlay } = trail;
  const windowLabel = TRAIL_WINDOWS.find((w) => w.hours === hours)?.label ?? `${hours} h`;
  const previous = points[index - 1];

  return (
    <div
      role="region"
      aria-label="Trail playback"
      data-testid="trail-panel"
      className="absolute bottom-4 left-1/2 z-20 w-[min(560px,calc(100%-24px))] -translate-x-1/2 rounded-[var(--radius-md)] border border-border bg-bg-surface p-3 text-text-primary shadow-[var(--shadow-float)]"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-secondary">Trail</span>
        <div className="flex gap-1" role="group" aria-label="Trail window">
          {TRAIL_WINDOWS.map((w) => (
            <Chip key={w.hours} label={w.label} active={w.hours === hours} onClick={() => onHoursChange(w.hours)} testId={`trail-window-${w.hours}`} />
          ))}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Hide trail" data-testid="trail-close" className="ml-auto">
          <X size={20} strokeWidth={1.5} />
        </Button>
      </div>

      {status === "loading" && <p className="text-xs text-text-secondary">Loading the trail…</p>}
      {status === "error" && <p className="text-xs" style={{ color: "var(--status-breach)" }}>The trail could not be loaded.</p>}
      {status === "ready" && points.length === 0 && (
        <p className="text-xs text-text-secondary" data-testid="trail-empty">No fixes in the last {windowLabel}.</p>
      )}

      {status === "ready" && points.length > 0 && (
        <>
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              onClick={togglePlay}
              disabled={points.length < 2}
              aria-label={playing ? "Pause playback" : "Play from the start"}
              data-testid="trail-play"
              className="rounded-full"
            >
              {playing ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
            </Button>
            <input
              type="range"
              min={0}
              max={points.length - 1}
              step={1}
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
              aria-label="Scrub through the fixes"
              aria-valuetext={current ? formatAbsoluteTime(current.fixedAt) : undefined}
              data-testid="trail-slider"
              className="h-2 flex-1 cursor-pointer"
              style={{ accentColor: "var(--brand)" }}
            />
            <span className="shrink-0 tabular-nums text-xs text-text-secondary" data-testid="trail-position">
              {positionLabel(index, points.length)}
            </span>
          </div>
          {current && (
            <p className="mt-2 text-xs text-text-secondary" data-testid="trail-readout">
              <span className="text-text-primary">{formatAbsoluteTime(current.fixedAt)}</span>
              {current.speedKmh !== null && <> · {current.speedKmh.toFixed(1)} km/h</>}
              {current.batteryPct !== null && <> · battery {current.batteryPct}%</>}
              {previous && <> · {gapMinutes(previous, current)} min since the previous fix</>}
            </p>
          )}
        </>
      )}
    </div>
  );
}
