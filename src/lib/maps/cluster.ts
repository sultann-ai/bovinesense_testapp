/**
 * What a cluster of animals looks like. Pure and client-safe.
 *
 * DESIGN.md §6 "Clustering": cluster below zoom 10; a cluster bubble shows its count; if it contains
 * any breach it gets a crimson outer ring and a small red badge with the breach count. Breaches
 * must never hide inside a cluster.
 */
import { normalizeStatus, type AnimalStatus } from "./status";

/** Clusters exist up to this zoom; from zoom 10 every animal is its own pin. */
export const CLUSTER_MAX_ZOOM = 9;
/** Pixel radius within which pins merge into one cluster. */
export const CLUSTER_RADIUS_PX = 60;

export interface ClusterSummary {
  count: number;
  breaches: number;
  /** The most urgent status inside the cluster. */
  worst: AnimalStatus;
}

const URGENCY: AnimalStatus[] = ["breach", "fast", "near", "stale", "inside"];

export function summarizeCluster(statuses: readonly unknown[]): ClusterSummary {
  let breaches = 0;
  const seen = new Set<AnimalStatus>();
  for (const s of statuses) {
    const status = normalizeStatus(s);
    seen.add(status);
    if (status === "breach") breaches++;
  }
  return {
    count: statuses.length,
    breaches,
    worst: URGENCY.find((s) => seen.has(s)) ?? "inside",
  };
}

export interface ClusterVisual {
  /** Bubble size in px: bigger clusters are bigger bubbles. */
  diameter: number;
  /** The count, abbreviated for large numbers. */
  label: string;
  hasBreach: boolean;
  /** The text of the red badge ("3", "99+"); empty when there is no breach. */
  breachLabel: string;
  /** What a screen reader says. */
  ariaLabel: string;
}

function abbreviate(n: number): string {
  if (n < 1000) return String(n);
  return `${Math.floor(n / 100) / 10}k`.replace(".0k", "k");
}

export function clusterVisual(summary: ClusterSummary): ClusterVisual {
  const { count, breaches } = summary;
  const diameter = count < 10 ? 36 : count < 100 ? 44 : 52;
  const animals = `${count} animal${count === 1 ? "" : "s"}`;
  return {
    diameter,
    label: abbreviate(count),
    hasBreach: breaches > 0,
    breachLabel: breaches === 0 ? "" : breaches > 99 ? "99+" : String(breaches),
    ariaLabel: breaches > 0 ? `${animals}, ${breaches} in breach` : animals,
  };
}
