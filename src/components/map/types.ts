/** A saved geofence as the map receives it from GET /api/geofences/features. */
export interface FenceFeature {
  type: "Feature";
  id: number;
  geometry: { type: string; coordinates?: unknown } | null;
  properties: {
    id: number;
    name: string;
    type: "district" | "polygon" | "radius";
    warning_buffer_m: number;
    district_name: string | null;
    center_lat: number | null;
    center_lon: number | null;
    radius_m: number | null;
    animal_count: number;
    breach_count: number;
  };
}
