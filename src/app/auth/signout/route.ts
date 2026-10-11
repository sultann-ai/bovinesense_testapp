/**
 * POST /auth/signout
 *
 * Ends the Supabase session and forgets the active organization, then sends the browser
 * to /login with a 303. A plain form POST (not a Server Action) so the browser does an
 * ordinary navigation with the cookies already cleared.
 */
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clearActiveOrganization } from "@/lib/auth/access";
import { isSameOriginRequest, seeOther } from "@/lib/auth/origin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers)) {
    return new Response("Forbidden", { status: 403 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  await clearActiveOrganization();
  return seeOther("/login");
}
