/**
 * Display formats (DESIGN.md §4): "08 Oct 2026, 14:32 PKT", relative time with the exact time on
 * hover, distances in km to one decimal, coordinates to five decimals.
 *
 * The timezone is a tenant setting (organizations.settings.timezone, default Asia/Karachi), so every
 * function that prints a clock time takes it. Pure and client-safe.
 */

export const DEFAULT_TIMEZONE = "Asia/Karachi";

/** Abbreviations browsers do not produce (Intl gives "GMT+5" for Karachi). */
const ZONE_ABBREVIATIONS: Record<string, string> = {
  "Asia/Karachi": "PKT",
  "Asia/Dubai": "GST",
  "Asia/Riyadh": "AST",
  "Asia/Kolkata": "IST",
  "Asia/Dhaka": "BST",
  UTC: "UTC",
  "Etc/UTC": "UTC",
};

/** A valid IANA timezone name, or the default. */
export function resolveTimezone(tz: unknown): string {
  if (typeof tz !== "string" || tz.trim() === "") return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz.trim() });
    return tz.trim();
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function zoneLabel(date: Date, tz: string): string {
  const known = ZONE_ABBREVIATIONS[tz];
  if (known) return known;
  const part = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}

export function formatRelativeTime(date: Date | string, now: number = Date.now()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = now - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} day${diffD !== 1 ? "s" : ""} ago`;
}

/** "08 Oct 2026, 14:32 PKT" in the tenant's timezone. */
export function formatAbsoluteTime(date: Date | string, timezone: string = DEFAULT_TIMEZONE): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const tz = resolveTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${zoneLabel(d, tz)}`;
}

export function formatDistance(km: number): string {
  return `${km.toFixed(1)} km`;
}

export function formatCoord(n: number): string {
  return n.toFixed(5);
}

/** Whole hours since `iso`, or null for no timestamp. */
export function hoursSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : (now - t) / 3_600_000;
}
