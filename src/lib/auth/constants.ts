/**
 * The active-organization cookie name, plus compatibility re-exports of the role helpers.
 * Roles and permissions now live in src/lib/permissions.ts (the mirror of the database
 * policies); new code should import from there.
 */

/** HttpOnly cookie holding the organization the user is currently working in. */
export const ORG_COOKIE = "bs_active_org";

export {
  ORG_ROLES as ROLES,
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
  can,
  isOrgRole as isRole,
  type AppRole,
  type OrgRole as Role,
  type Permission,
} from "../permissions";
