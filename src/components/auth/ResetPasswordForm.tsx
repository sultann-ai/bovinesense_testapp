"use client";

import { useEffect, useRef, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
import { PASSWORD_HINT, validatePassword } from "@/lib/auth/password";
import { FormError, PasswordField, PrimaryButton } from "./fields";
import { cardClass, linkButtonClass } from "./styles";

type Phase = "verifying" | "ready" | "invalid" | "saving" | "done";

const OTP_TYPES: readonly string[] = ["recovery", "invite", "signup", "magiclink", "email"];

/**
 * Sets a new password. Serves both the password-reset email and the invitation email.
 * The link can arrive in three shapes, depending on how the email was generated:
 *   ?code=...                          PKCE (reset requested from the sign-in page)
 *   #access_token=...&refresh_token=.. implicit (invitations sent by an administrator)
 *   ?token_hash=...&type=...           custom email templates
 * All three end with a session in the browser, after which `updateUser` sets the password.
 */
export function ResetPasswordForm() {
  const [phase, setPhase] = useState<Phase>("verifying");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // React strict mode runs effects twice in development; a code can only be used once.
    if (started.current) return;
    started.current = true;

    const supabase = createClient();

    (async () => {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type");
      const linkError = hash.get("error_description") ?? url.searchParams.get("error_description");
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      let failed = false;
      let reason = "";
      try {
        if (linkError) {
          failed = true;
          reason = "link error";
        } else if (accessToken && refreshToken) {
          // Implicit-grant link (invitations). The PKCE client does not handle these by
          // itself. An explicit link always wins over any session already in the browser,
          // so an invitation for one person can never set another person's password.
          await supabase.auth.initialize();
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          failed = Boolean(error);
          reason = error?.code ?? error?.message ?? "";
        } else if (tokenHash && type && OTP_TYPES.includes(type)) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as EmailOtpType,
          });
          failed = Boolean(error);
          reason = error?.code ?? error?.message ?? "";
        } else if (code) {
          // PKCE link (password reset requested from the sign-in page). The browser client
          // exchanges `?code=` on its own during initialize() and removes it from the URL;
          // calling exchangeCodeForSession again would find the one-time verifier already used.
          const { error } = await supabase.auth.initialize();
          failed = Boolean(error) || new URL(window.location.href).searchParams.has("code");
          reason = error?.code ?? error?.message ?? (failed ? "code not exchanged" : "");
          if (!failed) {
            const { data } = await supabase.auth.getSession();
            failed = !data.session;
            reason = failed ? "no session after exchange" : "";
          }
        } else {
          // Opened without a link: fine only if the user is already signed in.
          await supabase.auth.initialize();
          const { data } = await supabase.auth.getSession();
          failed = !data.session;
          reason = failed ? "no session" : "";
        }
      } catch (err) {
        failed = true;
        reason = err instanceof Error ? err.message : "unknown";
      }

      // Never leave one-time tokens in the address bar or browser history.
      window.history.replaceState(null, "", "/reset-password");
      // Help support diagnose a refused link without exposing the token itself.
      if (failed) console.warn("[reset-password] link rejected:", reason || "unknown");
      setPhase(failed ? "invalid" : "ready");
    })();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    const problem = validatePassword(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("The two passwords do not match.");

    setPhase("saving");
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setPhase("ready");
      return;
    }

    setPhase("done");
    // Full navigation: /org/continue is a route handler, not a client-side route.
    window.location.assign("/org/continue");
  }

  if (phase === "verifying") {
    return (
      <section className={cardClass} aria-busy="true">
        <h1 className="text-2xl font-semibold leading-8 text-text-primary">Checking your link…</h1>
        <p className="mt-1 text-[0.8125rem] leading-[1.125rem] text-text-secondary">One moment.</p>
      </section>
    );
  }

  if (phase === "invalid") {
    return (
      <section className={cardClass}>
        <h1 className="text-2xl font-semibold leading-8 text-text-primary">This link has expired</h1>
        <p className="mt-1 text-[0.8125rem] leading-[1.125rem] text-text-secondary">
          Reset and invitation links work once and expire after a short time. Request a new link
          from the sign-in page, or ask your administrator to invite you again.
        </p>
        <div className="mt-6">
          <a href="/login" className={linkButtonClass}>Back to sign in</a>
        </div>
      </section>
    );
  }

  const busy = phase === "saving" || phase === "done";

  return (
    <section className={cardClass}>
      <h1 className="text-2xl font-semibold leading-8 text-text-primary">Set your password</h1>
      <p className="mt-1 text-[0.8125rem] leading-[1.125rem] text-text-secondary">{PASSWORD_HINT}</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <PasswordField id="password" label="New password" autoComplete="new-password" autoFocus />
        <PasswordField id="confirm" label="Confirm password" autoComplete="new-password" />

        {error && <FormError>{error}</FormError>}

        <PrimaryButton pending={busy} pendingLabel="Saving…">
          Save password
        </PrimaryButton>
      </form>
    </section>
  );
}
