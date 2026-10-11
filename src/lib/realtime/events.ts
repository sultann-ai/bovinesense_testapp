/**
 * The live events the dashboard reacts to, and the mapping from Supabase Realtime's
 * `postgres_changes` payloads to them. Pure and client-safe: no React, no Supabase imports.
 *
 * Who receives a change is decided by Postgres: Realtime only delivers a row to a subscriber whose
 * own role passes Row Level Security. `toLiveEvent` additionally drops any row that does not belong
 * to the active organization (a user who is in two organizations can legitimately read both, and the
 * subscription filter is a courtesy, not a guarantee), and any payload that is not shaped as expected.
 */

export interface LiveFix {
  id: number;
  animalId: number;
  tagId: number;
  lat: number;
  lon: number;
  fixedAt: string;
  speedKmh: number | null;
  batteryPct: number | null;
}

export interface LiveAlert {
  id: number;
  animalId: number;
  type: string;
  severity: string;
  status: string;
  title: string;
  detail: string | null;
}

export interface LiveAnimal {
  id: number;
  status: string;
}

export type LiveEvent =
  | { kind: "fix"; fix: LiveFix }
  | { kind: "alert"; op: "INSERT" | "UPDATE"; alert: LiveAlert }
  | { kind: "animal"; animal: LiveAnimal };

/** The tables subscribed to, and the change type each one is listened to for. */
export const LIVE_SUBSCRIPTIONS = [
  { table: "fixes", event: "INSERT" },
  { table: "alerts", event: "*" },
  { table: "animals", event: "UPDATE" },
] as const;
export type LiveTable = (typeof LIVE_SUBSCRIPTIONS)[number]["table"];

/** The slice of a Realtime payload this module reads. */
export interface ChangePayload {
  eventType: string;
  new?: unknown;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === "string";
const optNum = (v: unknown): number | null => (num(v) ? v : null);

export function toLiveEvent(table: string, change: ChangePayload, organizationId: string): LiveEvent | null {
  const row = change.new;
  if (typeof row !== "object" || row === null) return null; // DELETEs carry no new row
  const r = row as Record<string, unknown>;

  // Never act on another organization's row, whatever the server sent.
  if (r.organization_id !== organizationId) return null;

  switch (table) {
    case "fixes": {
      if (change.eventType !== "INSERT") return null;
      if (!num(r.id) || !num(r.animal_id) || !num(r.tag_id) || !num(r.lat) || !num(r.lon) || !str(r.fixed_at)) return null;
      return {
        kind: "fix",
        fix: {
          id: r.id, animalId: r.animal_id, tagId: r.tag_id, lat: r.lat, lon: r.lon, fixedAt: r.fixed_at,
          speedKmh: optNum(r.speed_kmh), batteryPct: optNum(r.battery_pct),
        },
      };
    }
    case "alerts": {
      if (change.eventType !== "INSERT" && change.eventType !== "UPDATE") return null;
      if (!num(r.id) || !num(r.animal_id) || !str(r.type) || !str(r.severity) || !str(r.status) || !str(r.title)) return null;
      return {
        kind: "alert",
        op: change.eventType,
        alert: {
          id: r.id, animalId: r.animal_id, type: r.type, severity: r.severity, status: r.status, title: r.title,
          detail: str(r.detail) ? r.detail : null,
        },
      };
    }
    case "animals": {
      if (change.eventType !== "UPDATE") return null;
      if (!num(r.id) || !str(r.status)) return null;
      return { kind: "animal", animal: { id: r.id, status: r.status } };
    }
    default:
      return null;
  }
}
