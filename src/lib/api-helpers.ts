/**
 * Small helpers shared by the Next.js API route handlers.
 * Pure functions, no Supabase or Next imports, so they are unit-testable.
 */

/** Best-effort message from an Error, a PostgrestError-like object, or anything else. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Internal error";
}

/** PostgREST / Postgres error code, if the thrown value carries one. */
export function errorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Quote a value for use inside a PostgREST `or=(...)` filter. Values containing
 * commas, parentheses or dots would otherwise break the filter syntax (or let a
 * caller inject extra conditions).
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `col1.ilike."%term%",col2.ilike."%term%"` for use with `.or()`. */
export function ilikeAny(columns: readonly string[], term: string): string {
  const pattern = quoteFilterValue(`%${term}%`);
  return columns.map((c) => `${c}.ilike.${pattern}`).join(",");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Parse an optional integer query parameter. Returns null when absent, NaN when malformed. */
export function intParam(value: string | null): number | null {
  if (value === null || value === "") return null;
  return /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** Clamp a numeric query parameter, falling back to `fallback` when absent or malformed. */
export function clampInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = intParam(value);
  if (n === null || Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Validate a query parameter against an allow-list. */
export function enumParam<T extends string>(
  value: string | null,
  allowed: readonly T[],
): { ok: true; value: T | null } | { ok: false } {
  if (value === null || value === "") return { ok: true, value: null };
  return (allowed as readonly string[]).includes(value)
    ? { ok: true, value: value as T }
    : { ok: false };
}

/** Parse a YYYY-MM-DD (or ISO) date parameter; null when absent, undefined when malformed. */
export function dateParam(value: string | null): Date | null | undefined {
  if (value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
