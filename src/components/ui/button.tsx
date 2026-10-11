import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Buttons (DESIGN.md §8): 36 px tall, 6 px radius.
 *   primary      terracotta, white label
 *   secondary    1 px charcoal outline
 *   ghost        text only
 *   destructive  crimson (breach colour), white label
 * `icon` is the 36 px square for icon-only buttons (always give it an aria-label).
 */
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)]",
    "text-sm font-medium transition-colors duration-150 outline-none",
    "focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:bg-brand-hover",
        secondary: "border border-text-primary bg-transparent text-text-primary hover:bg-bg-sunken",
        ghost: "bg-transparent text-text-secondary hover:bg-bg-sunken hover:text-text-primary",
        destructive: "bg-status-breach text-white hover:opacity-90",
      },
      size: {
        default: "h-9 px-4",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Shows a busy label and disables the button. */
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, busy = false, disabled, type = "button", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  );
});
