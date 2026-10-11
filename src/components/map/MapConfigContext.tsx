"use client";

import { createContext, useContext } from "react";
import { DEFAULT_MAP_CONFIG, type MapConfig } from "@/lib/maps/regions";

/**
 * The tenant's map settings (where the map opens, which areas the buttons fit, how far the camera
 * may roam), parsed on the server from organizations.settings.map and provided by the app layout.
 * Outside the provider the defaults apply (Punjab and Pakistan).
 */
const MapConfigContext = createContext<MapConfig>(DEFAULT_MAP_CONFIG);

export function MapConfigProvider({ config, children }: { config: MapConfig; children: React.ReactNode }) {
  return <MapConfigContext.Provider value={config}>{children}</MapConfigContext.Provider>;
}

export function useMapConfig(): MapConfig {
  return useContext(MapConfigContext);
}
