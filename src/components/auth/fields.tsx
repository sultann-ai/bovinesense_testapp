"use client";

import { useState } from "react";
import { CircleAlert, Eye, EyeOff, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputClass, labelClass } from "./styles";
import { Button } from "@/components/ui/button";

/** Small form building blocks shared by the sign-in and reset-password pages. */

export function TextField({
  id, label, type = "text", autoComplete, autoFocus, required = true, minLength,
}: {
  id: string;
  label: string;
  type?: "text" | "email";
  autoComplete?: string;
  autoFocus?: boolean;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={required}
        minLength={minLength}
        className={inputClass}
      />
    </div>
  );
}

export function PasswordField({
  id, label, autoComplete, autoFocus, minLength,
}: {
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          minLength={minLength}
          className={cn(inputClass, "pr-10")}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-[var(--radius-sm)] text-text-secondary outline-none transition-colors hover:text-text-primary focus-visible:ring-1 focus-visible:ring-brand/30"
        >
          {visible ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
        </button>
      </div>
    </div>
  );
}

export function PrimaryButton({
  pending, pendingLabel, children,
}: {
  pending: boolean;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Button type="submit" busy={pending} className="w-full">
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** What failed, in one sentence. Announced to screen readers. */
export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-status-breach">
      <CircleAlert size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function FormNotice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-status-info-tint px-3 py-2 text-sm text-status-info"
    >
      <Info size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
