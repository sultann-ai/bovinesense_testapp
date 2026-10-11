import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. BYPASSES Row Level Security.
 *
 * Server-only: the "server-only" import above makes the build fail if this file
 * is ever pulled into a Client Component. Never import it from client code, never
 * expose the key through a NEXT_PUBLIC_* variable, and never return the client
 * (or the key) in a response.
 *
 * Standalone scripts (scripts/*.ts) cannot import this file because they run
 * outside Next.js; they build their own client in scripts/lib/supabase.ts.
 */
declare global {
  var _supabaseAdmin: SupabaseClient<Database> | undefined;
}

export function createAdminClient(): SupabaseClient<Database> {
  if (globalThis._supabaseAdmin) return globalThis._supabaseAdmin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.",
    );
  }

  globalThis._supabaseAdmin = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return globalThis._supabaseAdmin;
}
