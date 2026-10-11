"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The BovineSense product marks (not the tenant's logo; that is TenantLogo).
 *
 *   logo      public/brand/bovine.png   the complete logo, for the sign-in pages
 *   insignia  public/brand/bo.png       the small mark, for the sidebar and other tight spaces
 *
 * bovine.png is a black wordmark for light backgrounds; bo.png has white letters and so always sits on a
 * small charcoal tile.
 *
 * If a file is missing or cannot load, a plain "B" tile is shown instead, so the screen never breaks.
 */
export const BRAND_LOGO_SRC = "/brand/bovine.png";
export const BRAND_INSIGNIA_SRC = "/brand/bo.png";

export function BrandMark({
  variant,
  height,
  className,
}: {
  variant: "logo" | "insignia";
  /** Height in px; the width follows the image's own proportions. */
  height: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        role="img"
        aria-label="BovineSense"
        className={cn("flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-brand text-sm font-bold text-white", className)}
        style={{ width: height, height }}
      >
        B
      </span>
    );
  }

  if (variant === "insignia") {
    // bo.png has white letters (made for dark backgrounds): on the white rail it sits on a small charcoal tile.
    return (
      <span
        className={cn("flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-text-primary", className)}
        style={{ width: height, height }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local file */}
        <img src={BRAND_INSIGNIA_SRC} alt="BovineSense" onError={() => setFailed(true)} className="object-contain" style={{ width: height * 0.7, height: height * 0.7 }} />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed local file; no resizing pipeline needed
    <img
      src={BRAND_LOGO_SRC}
      alt="BovineSense"
      height={height}
      onError={() => setFailed(true)}
      className={cn("shrink-0 object-contain", className)}
      style={{ height, width: "auto" }}
    />
  );
}
