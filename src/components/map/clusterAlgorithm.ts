import { SuperClusterAlgorithm, type Renderer } from "@googlemaps/markerclusterer";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS_PX, clusterVisual, summarizeCluster } from "@/lib/maps/cluster";
import { createClusterElement } from "./dom";

/**
 * Google's SuperClusterAlgorithm only re-reads marker positions when the SET of markers changes. An
 * animal that merely moves (same marker object, new position) would keep being clustered on its old
 * position until the next time a marker is added or removed. `invalidate()` makes it forget what it
 * loaded, so the next render re-reads every position. Call it whenever a position changed.
 */
export class RefreshableSuperClusterAlgorithm extends SuperClusterAlgorithm {
  constructor() {
    super({ radius: CLUSTER_RADIUS_PX, maxZoom: CLUSTER_MAX_ZOOM });
  }

  invalidate(): void {
    this.markers = [];
  }
}

export const Z_CLUSTER = 500;
export const Z_CLUSTER_WITH_BREACH = 600;

/**
 * Draws a cluster (DESIGN.md §6): its count, and when ANY animal inside is in breach, a crimson ring
 * and a badge with the breach count. `statusOf` tells it each marker's status.
 */
export function createClusterRenderer(
  markerLib: Pick<typeof google.maps.marker, "AdvancedMarkerElement">,
  statusOf: (marker: object) => string | undefined,
): Renderer {
  return {
    render: ({ count, position, markers }) => {
      const statuses = (markers ?? []).map((m) => statusOf(m) ?? "stale");
      const visual = clusterVisual({ ...summarizeCluster(statuses), count });
      return new markerLib.AdvancedMarkerElement({
        position,
        content: createClusterElement(visual),
        title: visual.ariaLabel,
        zIndex: visual.hasBreach ? Z_CLUSTER_WITH_BREACH : Z_CLUSTER,
      });
    },
  };
}
