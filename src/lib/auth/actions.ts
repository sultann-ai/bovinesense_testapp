"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "./paths";
import { clearActiveOrganization } from "./access";

/** State returned to the forms via useActionState. */
export interface AuthFormState {
  error?: string;
  message?: string;
  /**
   * Where the browser should go after a successful sign-in. The form navigates there
   * itself (a normal page load) instead of the action calling redirect(): Next resolves an
   * action redirect server-side using the cookies from before the action ran, which breaks
   * when the target is another redirect that depends on the session just created.
   */
  redirectTo?: string;
}

const SignInSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
  next: z.string().max(2000).optional(),
});

/**
 * Email + password sign-in. The same message is returned for an unknown email and a
 * wrong password so the form cannot be used to discover which addresses have accounts.
 */
export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "Enter your email address and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.status === 429 || error.code === "over_request_rate_limit") {
      return { error: "Too many attempts. Wait a few minutes and try again." };
    }
    return { error: "Incorrect email or password." };
  }

  // A fresh sign-in always re-resolves the organization (picker for several orgs).
  await clearActiveOrganization();
  return { redirectTo: `/org/continue?next=${encodeURIComponent(safeNextPath(parsed.data.next))}` };
}

const ForgotSchema = z.object({ email: z.string().trim().email().max(254) });

/**
 * Send a password-reset email. Always answers with the same neutral message so the
 * form does not reveal whether an address has an account. The link opens
 * /reset-password; the origin must be listed under Authentication -> URL Configuration.
 */
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = ForgotSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address." };

  const origin =
    (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? null;
  if (!origin) return { error: "The site address is not configured. Contact your administrator." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/reset-password`,
  });
  if (error) {
    if (error.status === 429 || error.code === "over_email_send_rate_limit") {
      return { error: "Too many reset emails requested. Try again in a few minutes." };
    }
    // Anything else (including "no such user") is logged, not shown.
    console.error("[auth] resetPasswordForEmail", error.code ?? error.message);
  }
  return {
    message: "If an account exists for that address, a reset link is on its way.",
  };
}
