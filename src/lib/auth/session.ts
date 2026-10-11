import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * The signed-in user, or null. Reads the verified JWT claims (signature checked via
 * the project's JWKS, or by the Auth server for legacy secrets), never the raw
 * cookie. Deduplicated per render with React `cache`.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
});
