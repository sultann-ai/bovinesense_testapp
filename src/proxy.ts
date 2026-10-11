/**
 * Next.js Proxy (the renamed middleware, see node_modules/next/dist/docs/.../proxy.md).
 *
 * For every request except static assets it:
 *   1. refreshes the Supabase session cookies (so long-lived tabs stay signed in),
 *   2. sends signed-out users to /login (pages) or answers 401 JSON (API), except for
 *      /login, /reset-password, /api/ingest/* and /api/health which are public,
 *   3. sends signed-in users who have not chosen an organization to /org/continue.
 *
 * This is a first line of defence, not the only one. Whether the chosen organization
 * is really the user's is checked against the database on every server request in
 * src/lib/auth/access.ts, and every Server Action and Route Handler re-checks auth
 * itself (a matcher change must never silently remove protection).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { ORG_COOKIE } from "@/lib/auth/constants";
import { isOrgOptionalPath, isPublicPath } from "@/lib/auth/paths";

/** Carry refreshed session cookies over to a redirect / error response. */
function carryCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Tags authenticate with their own API key; no session work, no extra round trips.
  // The health check is public and does no session work either.
  if (pathname === "/api/ingest" || pathname.startsWith("/api/ingest/") || pathname === "/api/health") {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail closed: without Supabase configured nothing can be authenticated.
    if (isPublicPath(pathname)) return NextResponse.next();
    return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Verifies the access token (refreshing it if needed). Do not run code between
  // createServerClient and this call; it is what keeps the session cookies in sync.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (isPublicPath(pathname)) {
    // Already signed in: the login page has nothing to offer.
    if (signedIn && pathname === "/login") {
      return carryCookies(response, NextResponse.redirect(new URL("/", request.url)));
    }
    return response;
  }

  if (!signedIn) {
    if (pathname.startsWith("/api/")) {
      return carryCookies(
        response,
        NextResponse.json(
          { error: "Unauthorized" },
          { status: 401, headers: { "x-auth-redirect": "/login" } },
        ),
      );
    }
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return carryCookies(response, NextResponse.redirect(login));
  }

  // Signed in. API handlers validate the organization themselves and answer JSON.
  if (pathname.startsWith("/api/") || isOrgOptionalPath(pathname)) return response;

  // No organization chosen yet: let /org/continue pick one (or show the picker).
  if (!request.cookies.has(ORG_COOKIE)) {
    const next = new URL("/org/continue", request.url);
    if (pathname !== "/") next.searchParams.set("next", pathname + search);
    return carryCookies(response, NextResponse.redirect(next));
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
