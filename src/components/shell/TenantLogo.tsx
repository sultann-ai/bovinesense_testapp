"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { initialsOfName } from "@/lib/branding";

/**
 * The tenant's logo (organizations.logo_url), or its initials on a brand tile when it has none or the
 * image cannot be loaded. Never a hardcoded tenant mark.
 */
export function TenantLogo({ name, logoUrl, size = 32, className }: { name: string; logoUrl: string | null; size?: number; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const show = logoUrl !== null && failedUrl !== logoUrl;

  if (show) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tenant logos come from storage or any https host
      <img
        src={logoUrl}
        alt={`${name} logo`}
        width={size}
        height={size}
        onError={() => setFailedUrl(logoUrl)}
        className={cn("shrink-0 rounded-[var(--radius-sm)] object-contain", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={`${name} logo`}
      data-testid="tenant-logo-fallback"
      className={cn("flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-brand-tint text-xs font-semibold text-brand-hover", className)}
      style={{ width: size, height: size }}
    >
      {initialsOfName(name)}
    </span>
  );
}
