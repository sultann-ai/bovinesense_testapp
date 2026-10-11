import { cn } from "@/lib/utils";

/**
 * Class names for the auth pages. A plain (non-"use client") module so Server Components
 * can import the strings directly; importing a value from a client module would give a
 * client reference instead.
 */
export const labelClass =
  "mb-1 block text-xs font-medium uppercase tracking-[0.04em] text-text-secondary";

export const inputClass = cn(
  "h-9 w-full rounded-[var(--radius-sm)] border border-border bg-bg-sunken px-3 text-sm",
  "text-text-primary placeholder:text-text-secondary outline-none transition-colors",
  "focus:border-brand focus:ring-1 focus:ring-brand/30",
);

/** A text-style button / link in the readable terracotta (--brand-hover). */
export const linkButtonClass =
  "text-sm font-medium text-brand-hover underline-offset-2 outline-none hover:underline focus-visible:underline";

export const cardClass =
  "rounded-[var(--radius-md)] border border-border bg-bg-surface p-8";
