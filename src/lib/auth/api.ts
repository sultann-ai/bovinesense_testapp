import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { can, type AppRole, type Permission } from "@/lib/permissions";
import { resolveAccess } from "./access";
import type { SessionUser } from "./session";

/**
 * Guard for Route Handlers. Every API route (except /api/ingest, which has its own
 * API key) starts with:
 *
 *   const auth = await requireApiAccess("alerts:transition");   // permission optional
 *   if (!auth.ok) return auth.response;
 *   const { ctx } = auth;
 *
 * ctx.db is a Supabase client acting as the SIGNED-IN USER (anon key + their session), so Row
 * Level Security applies to every query: the database itself refuses other tenants' rows and
 * actions the user's role may not take. Routes still filter by ctx.organizationId, because a
 * user who belongs to several organizations can see all of them under RLS, and still check
 * `can()` first to answer 403 with a clear message. The service-role client is not available here
 * on purpose; it is reserved for system paths with no user (tag ingestion, scripts).
 */

export interface ApiContext {
  db: SupabaseClient<Database>;
  user: SessionUser;
  organizationId: string;
  role: AppRole;
  /** Region / branch restriction from the membership (null = whole organization). */
  scope: { regionId: number | null; branchId: number | null };
  isPlatformAdmin: boolean;
}

export type ApiAuth = { ok: true; ctx: ApiContext } | { ok: false; response: NextResponse };

function fail(
  status: number,
  body: Record<string, unknown>,
  redirectTo?: string,
): { ok: false; response: NextResponse } {
  return {
    ok: false,
    // The browser-side SessionGuard follows x-auth-redirect when a fetch is refused.
    response: NextResponse.json(body, {
      status,
      headers: redirectTo ? { "x-auth-redirect": redirectTo } : undefined,
    }),
  };
}

export async function requireApiAccess(permission?: Permission): Promise<ApiAuth> {
  let result;
  try {
    result = await resolveAccess();
  } catch (err) {
    console.error("[auth] could not resolve access", err);
    return fail(503, { error: "Could not verify access." });
  }

  if (result.status === "unauthenticated") {
    return fail(401, { error: "Unauthorized" }, "/login");
  }
  if (result.status === "no_org") {
    return fail(
      403,
      { error: "No active organization selected.", code: "no_active_organization" },
      "/org/continue",
    );
  }

  const { access } = result;
  if (permission && !can(access.role, permission)) {
    return fail(403, { error: "Forbidden", code: "forbidden" });
  }

  return {
    ok: true,
    ctx: {
      db: await createClient(),
      user: access.user,
      organizationId: access.organization.id,
      role: access.role,
      scope: access.scope,
      isPlatformAdmin: access.isPlatformAdmin,
    },
  };
}

/**
 * Row filter for the views that carry organization_id, region_id and branch_id
 * (animal_overview, alert_overview, kpi_summary): always the organization, plus the
 * user's region or branch when their membership is scoped. Use with `.match(...)`.
 */
export function scopeMatch(ctx: Pick<ApiContext, "organizationId" | "scope">): {
  organization_id: string;
  region_id?: number;
  branch_id?: number;
} {
  const match: { organization_id: string; region_id?: number; branch_id?: number } = {
    organization_id: ctx.organizationId,
  };
  if (ctx.scope.branchId !== null) match.branch_id = ctx.scope.branchId;
  else if (ctx.scope.regionId !== null) match.region_id = ctx.scope.regionId;
  return match;
}
