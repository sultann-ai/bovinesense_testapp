"use client";

import { useActionState, useEffect, useState } from "react";
import { requestPasswordReset, signIn, type AuthFormState } from "@/lib/auth/actions";
import { FormError, FormNotice, PasswordField, PrimaryButton, TextField } from "./fields";
import { cardClass, linkButtonClass } from "./styles";

const initial: AuthFormState = {};

export function LoginForm({
  next,
  notice,
}: {
  /** Already validated on the server (safeNextPath). */
  next: string;
  notice: string | null;
}) {
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [signInState, signInAction, signingIn] = useActionState(signIn, initial);
  const [forgotState, forgotAction, sendingReset] = useActionState(requestPasswordReset, initial);

  // Signed in: do a normal page load so the next request carries the new session cookies.
  useEffect(() => {
    if (signInState.redirectTo) window.location.assign(signInState.redirectTo);
  }, [signInState.redirectTo]);

  if (mode === "forgot") {
    return (
      <section className={cardClass}>
        <h1 className="text-2xl font-semibold leading-8 text-text-primary">Reset your password</h1>
        <p className="mt-1 text-[0.8125rem] leading-[1.125rem] text-text-secondary">
          Enter your email address and we will send you a link to choose a new password.
        </p>

        <form action={forgotAction} className="mt-6 space-y-4">
          <TextField id="email" label="Email" type="email" autoComplete="username" autoFocus />
          {forgotState.error && <FormError>{forgotState.error}</FormError>}
          {forgotState.message && <FormNotice>{forgotState.message}</FormNotice>}
          <PrimaryButton pending={sendingReset} pendingLabel="Sending…">
            Send reset link
          </PrimaryButton>
        </form>

        <div className="mt-4">
          <button type="button" onClick={() => setMode("signin")} className={linkButtonClass}>
            Back to sign in
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={cardClass}>
      <h1 className="text-2xl font-semibold leading-8 text-text-primary">Sign in</h1>
      <p className="mt-1 text-[0.8125rem] leading-[1.125rem] text-text-secondary">
        Use the email address your organization invited.
      </p>

      {notice && (
        <div className="mt-4">
          <FormNotice>{notice}</FormNotice>
        </div>
      )}

      <form action={signInAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next} />
        <TextField id="email" label="Email" type="email" autoComplete="username" autoFocus />
        <PasswordField id="password" label="Password" autoComplete="current-password" />

        {signInState.error && <FormError>{signInState.error}</FormError>}

        <PrimaryButton pending={signingIn || Boolean(signInState.redirectTo)} pendingLabel="Signing in…">
          Sign in
        </PrimaryButton>
      </form>

      <div className="mt-4">
        <button type="button" onClick={() => setMode("forgot")} className={linkButtonClass}>
          Forgot password?
        </button>
      </div>

      <p className="mt-6 border-t border-border pt-4 text-[0.8125rem] leading-[1.125rem] text-text-secondary">
        Accounts are created by invitation. Ask your organization administrator if you need access.
      </p>
    </section>
  );
}
