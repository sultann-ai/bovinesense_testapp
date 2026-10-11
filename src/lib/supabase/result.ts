import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Helpers for turning supabase-js `{ data, error }` results into values.
 * Pure (no client import), so they are usable from routes, scripts and tests.
 *
 * The result type of a supabase-js query is a union
 * (`{ data: Row; error: null } | { data: null; error: PostgrestError }`), so the
 * helpers are generic over the whole `data` type rather than over the row.
 */
type Result<D> = { data: D; error: PostgrestError | null };

/** Return `data`, throwing the PostgREST error — or an error for an empty result. */
export function unwrap<D>(res: Result<D>): NonNullable<D> {
  if (res.error) throw res.error;
  if (res.data === null || res.data === undefined) {
    throw new Error("Unexpected empty response from Supabase");
  }
  return res.data as NonNullable<D>;
}

/** Return `data` or null (for `.maybeSingle()`), throwing on a PostgREST error. */
export function unwrapMaybe<D>(res: Result<D>): D | null {
  if (res.error) throw res.error;
  return res.data;
}

/** For writes with no returned rows: only check that there was no error. */
export function assertOk(res: { error: PostgrestError | null }): void {
  if (res.error) throw res.error;
}
