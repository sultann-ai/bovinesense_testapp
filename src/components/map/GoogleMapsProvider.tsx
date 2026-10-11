"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import { MapPinOff } from "lucide-react";
import { MAPS_LANGUAGE, MAPS_REGION, mapsConfig } from "@/lib/maps/config";
import { MapErrorBoundary } from "./MapErrorBoundary";

/**
 * Loads the Google Maps JavaScript API once, for the whole page, with `region=PK`.
 *
 * The API key and Map ID come from NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and NEXT_PUBLIC_GOOGLE_MAP_ID,
 * never from source. If either is missing the children are replaced by a short explanation instead
 * of a broken map. If Google rejects the key (usually because this site's address is not in the
 * key's HTTP-referrer allow-list) a notice is shown over the map, which stays mounted: Google
 * paints its own error over the tiles, and ours says what to do about it.
 */

interface MapsContextValue {
  mapId: string;
  authFailed: boolean;
}
const MapsContext = createContext<MapsContextValue | null>(null);

/** The Map ID for this page's maps (throws outside the provider: a map cannot exist without one). */
export function useMapId(): string {
  const v = useContext(MapsContext);
  if (!v) throw new Error("useMapId must be used inside <GoogleMapsProvider>");
  return v.mapId;
}

export function MapUnavailable({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="status"
      className={className ?? "absolute inset-0 flex items-center justify-center p-6"}
      style={{ backgroundColor: "var(--bg-sunken)" }}
    >
      <div
        className="max-w-sm rounded-[var(--radius-md)] border p-4 text-center"
        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border)" }}
      >
        <MapPinOff size={20} strokeWidth={1.5} className="mx-auto mb-2" style={{ color: "var(--text-secondary)" }} />
        <p className="text-sm font-medium text-text-primary">The map is unavailable</p>
        <p className="mt-1 text-xs text-text-secondary">{message}</p>
      </div>
    </div>
  );
}

/** `quiet` suppresses the key-rejected notice (for a small mini map that has no room for it). */
export function GoogleMapsProvider({ children, quiet = false }: { children: React.ReactNode; quiet?: boolean }) {
  const [authFailed, setAuthFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Google calls this global when it rejects the key (invalid, or the referrer is not allowed).
  useEffect(() => {
    const w = window as unknown as { gm_authFailure?: () => void };
    const previous = w.gm_authFailure;
    w.gm_authFailure = () => {
      setAuthFailed(true);
      previous?.();
    };
    return () => {
      w.gm_authFailure = previous;
    };
  }, []);

  const value = useMemo<MapsContextValue | null>(
    () => (mapsConfig.ok ? { mapId: mapsConfig.mapId, authFailed } : null),
    [authFailed],
  );

  if (!mapsConfig.ok || !value) return <MapUnavailable message={mapsConfig.ok ? "" : mapsConfig.message} />;
  if (loadFailed) {
    return <MapUnavailable message="Google Maps could not be loaded. Check the connection and that maps.googleapis.com is reachable, then reload." />;
  }

  return (
    <APIProvider
      apiKey={mapsConfig.apiKey}
      region={MAPS_REGION}
      language={MAPS_LANGUAGE}
      version="weekly"
      onError={() => setLoadFailed(true)}
    >
      <MapsContext.Provider value={value}>
        <MapErrorBoundary
          fallback={() => (
            <MapUnavailable message="The map could not be drawn. If Google rejected the API key (it is invalid, or this site's address is not in its HTTP-referrer list), fix the key's restrictions; see docs/MAP_STYLE.md. The rest of the page still works." />
          )}
        >
          {children}
        </MapErrorBoundary>
        {authFailed && !quiet && (
          <div
            role="alert"
            data-testid="maps-auth-failed"
            className="absolute right-3 top-3 z-20 max-w-xs rounded-[var(--radius-md)] border px-3 py-2 text-xs shadow-[var(--shadow-float)]"
            style={{ backgroundColor: "var(--status-breach-tint)", borderColor: "var(--status-breach)", color: "var(--status-breach)" }}
          >
            Google Maps rejected the API key. Check that this site&apos;s address is allowed in the key&apos;s HTTP-referrer
            restrictions, and that the Maps JavaScript API is enabled (docs/MAP_STYLE.md).
          </div>
        )}
      </MapsContext.Provider>
    </APIProvider>
  );
}
