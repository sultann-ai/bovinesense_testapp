/**
 * Supabase client for standalone scripts (simulator, boundary import).
 *
 * Scripts run outside Next.js, so they cannot import src/lib/supabase/admin.ts
 * (its "server-only" guard throws outside a React server build). They use the
 * service-role key from the environment instead — never from client code.
 *
 * Loads .env.local first (where Next.js keeps secrets), then .env.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/types/database";

config({ path: ".env.local" });
config();

export function createScriptClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).",
    );
    process.exit(1);
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
