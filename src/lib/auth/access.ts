import "server-only";
import { parseMapConfig, type MapConfig } from "@/lib/maps/regions";
import { parseTenantSettings, type TenantSettings } from "@/lib/tenant-settings";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/api-helpers";
import { isOrgRole, type AppRole } from "@/lib/permissions";
import { ORG_COOKIE } from "./constants";
import { getSessionUser, type SessionUser } from "./session";

/**
 * Who may do what, resolved from the database on every request.
 *
 * Everything here runs as the SIGNED-IN USER (anon key + their session), not with the service
 * role: the memberships, organizations and platform_admins rows it reads are exactly the ones
 * Row Level Security lets that user see. The active organization lives in an HttpOnly cookie, but
 * the cookie is only a hint: it is re-checked against the user's memberships on every request, so
 * editing it grants nothing.
 */

export interface OrganizationAccess {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  demoMode: boolean;
  /** Branding, timezone, demo banner and offline threshold, from the organization row. */
  tenant: TenantSettings;
  /** Where the map opens and how far it may roam (organizations.settings.map, with defaults). */
  map: MapConfig;
  /** The role the user holds here; `platform_admin` for BovineSense staff who are not members. */
  role: AppRole;
  regionId: number | null;
  branchId: number | null;
  /** True when the user is here only because they are a BovineSense platform admin. */
  viaPlatform: boolean;
}

export interface AccessList {
  isPlatformAdmin: boolean;
  organizations: OrganizationAccess[];
}

export interface ActiveAccess {
  user: SessionUser;
  organization: OrganizationAccess;
  role: AppRole;
  scope: { regionId: number | null; branchId: number | null };
  isPlatformAdmin: boolean;
}

export type AccessResult =
  | { status: "unauthenticated" }
  /** Signed in, but no (valid) active organization cookie. */
  | { status: "no_org"; user: SessionUser }
  | { status: "ok"; access: ActiveAccess };

const ORG_COLUMNS = "id, name, slug, logo_url, brand_settings, status, settings";

/** The organization columns this module reads. */
interface OrgRow {
  logo_url: string | null;
  brand_settings: unknown;
  settings: unknown;
}

function tenantOf(org: OrgRow): TenantSettings {
  return parseTenantSettings({ settings: org.settings, brandSettings: org.brand_settings, logoUrl: org.logo_url });
}

/** Every active organization this user may open (for the picker and /org/continue). */
export async function loadAccessList(userId: string): Promise<AccessList> {
  const db = await createClient();

  const [memberships, platform] = await Promise.all([
    db
      .from("memberships")
      .select("role, region_id, branch_id, organizations(id, name, slug, logo_url, brand_settings, status, settings)")
      .eq("user_id", userId),
    db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  ]);
  if (memberships.error) throw memberships.error;
  if (platform.error) throw platform.error;

  const isPlatformAdmin = Boolean(platform.data);
  const byId = new Map<string, OrganizationAccess>();

  for (const m of memberships.data) {
    const org = m.organizations;
    if (!org || org.status !== "active" || !isOrgRole(m.role)) continue;
    byId.set(org.id, {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: tenantOf(org).logoUrl,
      demoMode: tenantOf(org).demoMode,
      tenant: tenantOf(org),
      map: parseMapConfig(org.settings),
      role: m.role,
      // A platform admin's reads are not restricted by a membership scope (the database says so).
      regionId: isPlatformAdmin ? null : m.region_id,
      branchId: isPlatformAdmin ? null : m.branch_id,
      viaPlatform: false,
    });
  }

  if (isPlatformAdmin) {
    // The organizations policy lets platform admins read every organization.
    const all = await db.from("organizations").select(ORG_COLUMNS).eq("status", "active");
    if (all.error) throw all.error;
    for (const org of all.data) {
      if (byId.has(org.id)) continue;
      byId.set(org.id, {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logoUrl: tenantOf(org).logoUrl,
        demoMode: tenantOf(org).demoMode,
        tenant: tenantOf(org),
        map: parseMapConfig(org.settings),
        role: "platform_admin",
        regionId: null,
        branchId: null,
        viaPlatform: true,
      });
    }
  }

  const organizations = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { isPlatformAdmin, organizations };
}

/**
 * Resolve the signed-in user's access to the organization in the active-org cookie.
 * Three small queries, deduplicated per render with React `cache`.
 */
export const resolveAccess = cache(async (): Promise<AccessResult> => {
  const user = await getSessionUser();
  if (!user) return { status: "unauthenticated" };

  const cookieOrg = (await cookies()).get(ORG_COOKIE)?.value;
  if (!isUuid(cookieOrg)) return { status: "no_org", user };

  const db = await createClient();
  const [membership, platform, org] = await Promise.all([
    db
      .from("memberships")
      .select("role, region_id, branch_id")
      .eq("user_id", user.id)
      .eq("organization_id", cookieOrg)
      .maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
    db.from("organizations").select(ORG_COLUMNS).eq("id", cookieOrg).maybeSingle(),
  ]);
  if (membership.error) throw membership.error;
  if (platform.error) throw platform.error;
  if (org.error) throw org.error;

  const isPlatformAdmin = Boolean(platform.data);
  const row = org.data;
  const member = membership.data;

  // Unknown (to this user) or suspended organization, or one they have no right to.
  if (!row || row.status !== "active") return { status: "no_org", user };
  if (!member && !isPlatformAdmin) return { status: "no_org", user };
  if (member && !isOrgRole(member.role) && !isPlatformAdmin) return { status: "no_org", user };

  const role: AppRole = member && isOrgRole(member.role) ? member.role : "platform_admin";
  const scope = isPlatformAdmin || !member
    ? { regionId: null, branchId: null }
    : { regionId: member.region_id, branchId: member.branch_id };

  return {
    status: "ok",
    access: {
      user,
      isPlatformAdmin,
      role,
      scope,
      organization: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        logoUrl: tenantOf(row).logoUrl,
        demoMode: tenantOf(row).demoMode,
        tenant: tenantOf(row),
        map: parseMapConfig(row.settings),
        role,
        regionId: scope.regionId,
        branchId: scope.branchId,
        viaPlatform: isPlatformAdmin && !member,
      },
    },
  };
});

/** Display name for the user menu (their own profile row). */
export async function getDisplayName(userId: string): Promise<string | null> {
  const { data } = await (await createClient())
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return data?.full_name ?? null;
}

/** Apply the active-organization cookie. Call from Server Actions / Route Handlers only. */
export async function setActiveOrganization(organizationId: string): Promise<void> {
  (await cookies()).set(ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearActiveOrganization(): Promise<void> {
  (await cookies()).delete(ORG_COOKIE);
}
