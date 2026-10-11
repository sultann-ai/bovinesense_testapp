import { describe, it, expect } from "vitest";
import {
  can,
  isOrgRole,
  isReadOnly,
  ORG_ROLES,
  PERMISSIONS,
  permissionForTransition,
  permissionsFor,
  ROLE_LABELS,
  ROLE_SHORT_LABELS,
  type AppRole,
  type Permission,
} from "../src/lib/permissions";
import * as legacy from "../src/lib/auth/constants";

// The database-side proof that this table matches the real policies is in tests/db/rls.test.ts
// ("role x permission matrix"). These tests pin the table itself.
const EXPECTED: Record<AppRole, Permission[]> = {
  org_admin: [
    "alerts:acknowledge", "alerts:assign", "alerts:resolve",
    "geofences:manage", "users:manage", "settings:manage", "devices:manage",
  ],
  regional_manager: ["alerts:acknowledge", "alerts:assign", "alerts:resolve"],
  branch_officer: ["alerts:acknowledge", "alerts:assign", "alerts:resolve"],
  auditor: [],
  platform_admin: [],
};

describe("permissions matrix", () => {
  for (const [role, allowed] of Object.entries(EXPECTED) as Array<[AppRole, Permission[]]>) {
    it(`${role} holds exactly: ${allowed.join(", ") || "nothing (read-only)"}`, () => {
      expect(permissionsFor(role)).toEqual(PERMISSIONS.filter((p) => allowed.includes(p)));
      for (const p of PERMISSIONS) expect(can(role, p), `${role} ${p}`).toBe(allowed.includes(p));
    });
  }

  it("only org_admin manages geofences, users, settings and device keys", () => {
    for (const p of ["geofences:manage", "users:manage", "settings:manage", "devices:manage"] as const) {
      for (const role of ORG_ROLES) expect(can(role, p), `${role} ${p}`).toBe(role === "org_admin");
    }
  });

  it("only branch officers, regional managers and org admins work alerts", () => {
    for (const p of ["alerts:acknowledge", "alerts:assign", "alerts:resolve"] as const) {
      expect(can("branch_officer", p)).toBe(true);
      expect(can("regional_manager", p)).toBe(true);
      expect(can("org_admin", p)).toBe(true);
      expect(can("auditor", p)).toBe(false);
      expect(can("platform_admin", p)).toBe(false);
    }
  });

  it("fails closed for a missing role", () => {
    for (const p of PERMISSIONS) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
    }
  });

  it("auditors and platform admins are read-only; everyone else can change something", () => {
    expect(isReadOnly("auditor")).toBe(true);
    expect(isReadOnly("platform_admin")).toBe(true);
    expect(isReadOnly(null)).toBe(true);
    for (const r of ["org_admin", "regional_manager", "branch_officer"] as const) expect(isReadOnly(r)).toBe(false);
  });

  it("each alert status change maps to its own permission", () => {
    expect(permissionForTransition("acknowledged")).toBe("alerts:acknowledge");
    expect(permissionForTransition("assigned")).toBe("alerts:assign");
    expect(permissionForTransition("resolved")).toBe("alerts:resolve");
  });

  it("every role has a label, and platform admin is described as read-only", () => {
    for (const r of [...ORG_ROLES, "platform_admin"] as AppRole[]) {
      expect(ROLE_LABELS[r]).toBeTruthy();
      expect(ROLE_SHORT_LABELS[r]).toBeTruthy();
    }
    expect(ROLE_LABELS.platform_admin).toMatch(/read-only/i);
    expect(ROLE_LABELS.auditor).toMatch(/read-only/i);
  });

  it("isOrgRole accepts the four membership roles and nothing else", () => {
    for (const r of ORG_ROLES) expect(isOrgRole(r)).toBe(true);
    for (const bad of ["platform_admin", "hq_admin", "", undefined, null, 3]) expect(isOrgRole(bad)).toBe(false);
  });

  it("the old import path still re-exports the same helpers", () => {
    expect(legacy.can).toBe(can);
    expect(legacy.ROLES).toBe(ORG_ROLES);
    expect(legacy.ORG_COOKIE).toBe("bs_active_org");
  });
});
