/**
 * CSRF defence in depth for the form-POST route handlers (sign out, choose organization).
 * The session cookies are SameSite=Lax, which already keeps browsers from attaching them
 * to a cross-site POST; this additionally refuses a POST whose Origin (or, failing that,
 * Referer) names a different host than the one being served.
 *
 * Pure so it can be unit-tested. Requests with neither header (non-browser clients) pass:
 * they cannot ride a victim's cookies.
 */
export function isSameOriginRequest(headers: {
  get(name: string): string | null;
}): boolean {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const source = headers.get("origin") ?? headers.get("referer");
  if (!source || !host) return true;

  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

/** A 303 See Other, so the browser follows a POST with a plain GET. */
export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}
