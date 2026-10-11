/**
 * Roles and permissions: the application-side mirror of the database policies in
 * supabase/migrations/20261009000005_rls_policies.sql.
 *
 * The DATABASE is the authority: Row Level Security refuses anything a role may not do, whatever
 * the app says. This module exists so the app can (a) answer 403 early with a clear message and
 * (b) hide or disable controls a user could not use anyway. A test (tests/db/rls.test.ts) runs
 * every role x permission against the real policies and fails if this table and the database ever
 * disagree, so changing one without the other cannot go unnoticed.
 *
 * Pure and client-safe: no server imports.
 */

/** Roles a user can hold inside an organization (memberships.role). */
export const ORG_ROLES = ["org_admin", "regional_manager", "branch_officer", "auditor"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * What the app treats a signed-in user as inside the organization they are viewing.
 * `platform_admin` is BovineSense staff opening an organization they are not a member of:
 * they can READ across organizations, but hold no write permission anywhere.
 */
export type AppRole = OrgRole | "platform_admin";

export const ROLE_LABELS: Record<AppRole, string> = {
  org_admin:        "Organization admin",
  regional_manager: "Regional manager",
  branch_officer:   "Branch officer",
  auditor:          "Auditor (read-only)",
  platform_admin:   "Platform admin (read-only)",
};

/** Compact names for tight spaces such as the top-bar account button. */
export const ROLE_SHORT_LABELS: Record<AppRole, string> = {
  org_admin:        "Admin",
  regional_manager: "Regional manager",
  branch_officer:   "Branch officer",
  auditor:          "Auditor",
  platform_admin:   "Platform admin",
};

/**
 * Everything a user can be allowed to do. Reading is not a permission: any member of an
 * organization can read what their scope (organization / region / branch) covers.
 */
export const PERMISSIONS = [
  "alerts:acknowledge",
  "alerts:assign",
  "alerts:resolve",
  "geofences:manage",
  "users:manage",
  "settings:manage",
  "devices:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALERT_WORKERS: readonly OrgRole[] = ["org_admin", "regional_manager", "branch_officer"];

const GRANTS: Record<Permission, readonly OrgRole[]> = {
  // Acknowledge, assign and resolve alerts (inside the user's region / branch scope).
  "alerts:acknowledge": ALERT_WORKERS,
  "alerts:assign":      ALERT_WORKERS,
  "alerts:resolve":     ALERT_WORKERS,
  // Organization-level configuration: org_admin only.
  "geofences:manage": ["org_admin"],
  "users:manage":     ["org_admin"],
  "settings:manage":  ["org_admin"],
  // Device API keys: create and revoke the keys tags and gateways authenticate with.
  "devices:manage":   ["org_admin"],
};

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

export function can(role: AppRole | null | undefined, permission: Permission): boolean {
  if (!role || role === "platform_admin") return false;
  return GRANTS[permission].includes(role);
}

export function permissionsFor(role: AppRole | null | undefined): Permission[] {
  return PERMISSIONS.filter((p) => can(role, p));
}

/** True when the role can change nothing at all (auditors, platform admins). */
export function isReadOnly(role: AppRole | null | undefined): boolean {
  return permissionsFor(role).length === 0;
}

/** Which permission an alert status change needs. */
export function permissionForTransition(
  toStatus: "acknowledged" | "assigned" | "resolved",
): Permission {
  switch (toStatus) {
    case "acknowledged": return "alerts:acknowledge";
    case "assigned":     return "alerts:assign";
    case "resolved":     return "alerts:resolve";
  }
}
