import type { StyleSpecification } from "maplibre-gl";

export const STATUS_COLORS: Record<string, string> = {
  inside: "#3E7C59",
  near:   "#B7791F",
  breach: "#B0172E",
  fast:   "#6D3FA8",
  stale:  "#7A7F87",
};

export const PUNJAB_BOUNDS: [[number, number], [number, number]] = [
  [69.9, 27.7],
  [75.5, 33.9],
];
export const PAKISTAN_BOUNDS: [[number, number], [number, number]] = [
  [60.9, 23.6],
  [77.8, 37.1],
];

export function buildMapStyle(apiKey: string): StyleSpecification | string {
  if (apiKey) {
    return `https://api.maptiler.com/maps/basic-v2/style.json?key=${apiKey}`;
  }
  // No-key fallback — cream background only; our GeoJSON layers are added dynamically
  return {
    version: 8,
    sources: {},
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#F3EDE3" },
      },
    ],
  } as StyleSpecification;
}
