/**
 * GET /org/continue?next=/path
 *
 * Lands here after sign-in (and whenever the active organization is missing or no
 * longer valid). It works out where the user should go:
 *
 *   no usable organization             -> sign out, back to /login with a message
 *   active-org cookie is still valid   -> straight to `next`
 *   exactly one organization           -> remember it, go to `next`
 *   several organizations / platform   -> the organization picker
 *
 * A Route Handler (not a page) because it has to set a cookie.
 */
import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { clearActiveOrganization, loadAccessList, setActiveOrganization } from "@/lib/auth/access";
import { ORG_COOKIE } from "@/lib/auth/constants";
import { safeNextPath } from "@/lib/auth/paths";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { isPlatformAdmin, organizations } = await loadAccessList(user.id);

  if (organizations.length === 0) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    await clearActiveOrganization();
    redirect("/login?error=no_access");
  }

  const current = (await cookies()).get(ORG_COOKIE)?.value;
  if (organizations.some((o) => o.id === current)) redirect(next);

  if (organizations.length === 1 && !isPlatformAdmin) {
    await setActiveOrganization(organizations[0].id);
    redirect(next);
  }

  await clearActiveOrganization();
  redirect(`/select-organization?next=${encodeURIComponent(next)}`);
}
