/**
 * Route rules shared by the proxy and the server code. Pure, no server imports.
 */

const PUBLIC_PAGES = ["/login", "/reset-password"];
/** Exact paths only: the liveness check, which reveals nothing (see src/app/api/health/route.ts). */
const PUBLIC_EXACT = ["/api/health"];

/**
 * Routes reachable without a session: the login and password-reset pages, the
 * tag ingestion endpoint (it authenticates with its own API key) and the health check.
 */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGES.includes(pathname) || PUBLIC_EXACT.includes(pathname)) return true;
  return pathname === "/api/ingest" || pathname.startsWith("/api/ingest/");
}

/** The organization picker and the handlers behind it. */
export function isOrgSelectionPath(pathname: string): boolean {
  return pathname === "/select-organization" || pathname === "/org" || pathname.startsWith("/org/");
}

/**
 * Routes a signed-in user may use before choosing an organization: the picker and
 * its handlers, and sign-out (so someone stuck on the picker can always leave).
 */
export function isOrgOptionalPath(pathname: string): boolean {
  return isOrgSelectionPath(pathname) || pathname === "/auth/signout";
}

/**
 * Validate a post-login destination. Only same-site absolute paths are allowed so a
 * crafted `?next=` cannot send someone to another site (open redirect). Anything else,
 * and the auth pages themselves (redirect loops), falls back to `fallback`.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || next.length > 2000) return fallback;
  if (!next.startsWith("/")) return fallback;
  // "//host" and "/\host" are treated as protocol-relative URLs by browsers.
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  // Control characters (header injection / parser confusion).
  // Also refuse percent-encoded ones (%00-%1f, %7f) in case something decodes later.
  if (/[\u0000-\u001f\u007f]/.test(next) || /%(?:[01][0-9a-f]|7f)/i.test(next)) return fallback;

  let url: URL;
  try {
    url = new URL(next, "http://placeholder.invalid");
  } catch {
    return fallback;
  }
  if (url.host !== "placeholder.invalid") return fallback;
  if (isPublicPath(url.pathname) || isOrgOptionalPath(url.pathname)) return fallback;
  if (url.pathname.startsWith("/api/")) return fallback;

  return url.pathname + url.search + url.hash;
}
