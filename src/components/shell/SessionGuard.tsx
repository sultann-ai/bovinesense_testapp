"use client";

import { useEffect } from "react";

/**
 * Keeps a long-lived dashboard tab honest. The API refuses a request with 401 (session
 * gone) or 403 `no_active_organization` (membership revoked, organization suspended) and
 * names where to go in an `x-auth-redirect` header. This follows that header for any
 * same-origin /api call, so an expired tab lands on the sign-in page instead of showing
 * silently empty panels.
 */
export function SessionGuard() {
  useEffect(() => {
    const original = window.fetch;
    let redirecting = false;

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      if (!redirecting && (response.status === 401 || response.status === 403)) {
        const to = response.headers.get("x-auth-redirect");
        if (to && to.startsWith("/") && !to.startsWith("//")) {
          redirecting = true;
          window.location.assign(to);
        }
      }
      return response;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  return null;
}
