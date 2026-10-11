"use client";

import { createContext, useContext, useMemo } from "react";
import { can as roleCan, isReadOnly, type AppRole, type Permission } from "@/lib/permissions";

/**
 * Makes the signed-in user's role available to client components so they can hide or disable
 * controls the user could not use. This is a convenience, not a security boundary: the API
 * checks the same permissions and the database refuses anything the role may not do.
 *
 * Fails closed: outside a provider nobody can do anything.
 */
interface PermissionsValue {
  role: AppRole | null;
  can: (permission: Permission) => boolean;
  /** True for roles that can change nothing (auditors, platform admins). */
  readOnly: boolean;
}

const PermissionsContext = createContext<PermissionsValue>({
  role: null,
  can: () => false,
  readOnly: true,
});

export function PermissionsProvider({
  role,
  children,
}: {
  role: AppRole;
  children: React.ReactNode;
}) {
  const value = useMemo<PermissionsValue>(
    () => ({ role, can: (p) => roleCan(role, p), readOnly: isReadOnly(role) }),
    [role],
  );
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): PermissionsValue {
  return useContext(PermissionsContext);
}
