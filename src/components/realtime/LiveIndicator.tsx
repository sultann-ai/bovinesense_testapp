"use client";

import { RefreshCw, Wifi } from "lucide-react";
import { useLive } from "./RealtimeProvider";

/**
 * The small "Live / Reconnecting" pill in the top bar. Icon + word + colour, never colour alone.
 * Honest freshness: while it is not "Live", what is on screen may be out of date, and it is
 * refetched as soon as the connection is back.
 */
export function LiveIndicator() {
  const { status } = useLive();

  const live = status === "live";
  const label = live ? "Live" : status === "connecting" ? "Connecting…" : "Reconnecting…";
  const title = live
    ? "Receiving updates in real time"
    : "Not receiving live updates right now. What you see may be out of date; it refreshes automatically when the connection is back.";
  const Icon = live ? Wifi : RefreshCw;

  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="live-indicator"
      data-status={status}
      title={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-full)] px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: live ? "var(--status-inside-tint)" : "var(--status-near-tint)",
        color: live ? "var(--status-inside)" : "var(--status-near)",
      }}
    >
      <Icon size={14} strokeWidth={1.5} aria-hidden />
      {label}
    </span>
  );
}
