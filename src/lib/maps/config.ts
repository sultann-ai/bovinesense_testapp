/**
 * The Google Maps configuration, from the environment. Never hardcode a key (see
 * docs/MAP_STYLE.md "Protecting the API key"): both values are NEXT_PUBLIC_* variables, public by
 * design because they ship to the browser, so the key MUST be restricted to your domains in the
 * Google Cloud Console; a restriction, not secrecy, is what protects it.
 */

export type MapsConfig =
  | { ok: true; apiKey: string; mapId: string }
  | { ok: false; reason: "missing_key" | "missing_map_id"; message: string };

/** Pure so it is testable; the environment is read in `mapsConfig` below. */
export function resolveMapsConfig(apiKey: string | undefined, mapId: string | undefined): MapsConfig {
  const key = apiKey?.trim();
  const id = mapId?.trim();
  if (!key) {
    return {
      ok: false,
      reason: "missing_key",
      message: "The map is not configured: set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (see docs/MAP_STYLE.md).",
    };
  }
  if (!id) {
    return {
      ok: false,
      reason: "missing_map_id",
      message: "The map is not configured: set NEXT_PUBLIC_GOOGLE_MAP_ID. A Map ID is required for the animal markers and the BovineSense style.",
    };
  }
  return { ok: true, apiKey: key, mapId: id };
}

// Next.js inlines NEXT_PUBLIC_* only for these literal property reads.
export const mapsConfig: MapsConfig = resolveMapsConfig(
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  process.env.NEXT_PUBLIC_GOOGLE_MAP_ID,
);

/** The region the Maps JavaScript API is loaded for (biases geocoding and labels towards Pakistan). */
export const MAPS_REGION = "PK";
export const MAPS_LANGUAGE = "en";
