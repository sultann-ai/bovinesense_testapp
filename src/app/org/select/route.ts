/**
 * POST /org/select   (form fields: organization_id, next)
 *
 * Chooses the organization to work in. Re-verifies on the server that the signed-in user
 * may open it (member of an active organization, or platform admin) before setting the
 * HttpOnly cookie, then sends the browser on with a 303.
 */
import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/api-helpers";
import { loadAccessList, setActiveOrganization } from "@/lib/auth/access";
import { isSameOriginRequest, seeOther } from "@/lib/auth/origin";
import { safeNextPath } from "@/lib/auth/paths";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers)) {
    return new Response("Forbidden", { status: 403 });
  }

  const user = await getSessionUser();
  if (!user) return seeOther("/login");

  const form = await request.formData();
  const organizationId = form.get("organization_id");
  const next = safeNextPath(String(form.get("next") ?? ""));
  const back = `/select-organization?next=${encodeURIComponent(next)}`;

  if (!isUuid(organizationId)) return seeOther(`${back}&error=invalid`);

  const list = await loadAccessList(user.id);
  const chosen = list.organizations.find((o) => o.id === organizationId);
  if (!chosen) return seeOther(`${back}&error=forbidden`);

  // Cross-tenant access by BovineSense staff is audited (see README, "Security").
  if (chosen.viaPlatform) {
    // Written as the user: the RLS policy only lets a platform admin log their own access.
    const { error } = await (await createClient()).from("platform_audit_log").insert({
      user_id: user.id,
      organization_id: chosen.id,
      action: "select_organization",
      detail: { email: user.email },
    });
    if (error) console.error("[auth] platform audit log failed", error.message);
  }

  await setActiveOrganization(chosen.id);
  return seeOther(next);
}
