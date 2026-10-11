/**
 * Tenant branding: an optional accent colour and a logo, read from the organizations row
 * (`brand_settings.accent`, `logo_url`). Pure and client-safe.
 *
 * Rules (README, "Design system"): BovineSense tokens are the default; a tenant may override the
 * BRAND tokens only (--brand, --brand-hover, --brand-tint), never the status tokens, so a breach
 * can never be re-coloured by a tenant. An accent that would make white button labels or terracotta-style
 * links hard to read is ignored rather than applied.
 */

/** Minimum contrast for white text on the accent (WCAG AA for normal text). */
const MIN_CONTRAST_ON_WHITE = 4.5;

export interface Brand {
  /** `#RRGGBB`, or null for the BovineSense default. */
  accent: string | null;
}

export const DEFAULT_BRAND: Brand = { accent: null };

const HEX6 = /^#[0-9a-fA-F]{6}$/;

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
}

function linear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of `#RRGGBB` (WCAG 2.x). */
export function luminance(hex: string): number {
  return 0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
}

/** Contrast ratio of white text on `hex`. */
export function contrastOnWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/** The accent from `brand_settings`, or null when it is missing, malformed or unreadable with white text. */
export function parseBrand(brandSettings: unknown): Brand {
  if (typeof brandSettings !== "object" || brandSettings === null || Array.isArray(brandSettings)) return DEFAULT_BRAND;
  const accent = (brandSettings as Record<string, unknown>).accent;
  if (typeof accent !== "string" || !HEX6.test(accent.trim())) return DEFAULT_BRAND;
  const hex = accent.trim().toUpperCase();
  return contrastOnWhite(hex) >= MIN_CONTRAST_ON_WHITE ? { accent: hex } : DEFAULT_BRAND;
}

/**
 * The CSS variables that apply a brand, to set on the shell's wrapper element. Empty for the
 * default brand (the tokens in globals.css then apply untouched). Only brand tokens are ever set.
 */
export function brandStyle(brand: Brand): Record<string, string> {
  if (!brand.accent) return {};
  return {
    "--brand": brand.accent,
    "--brand-hover": `color-mix(in srgb, ${brand.accent} 85%, black)`,
    "--brand-tint": `color-mix(in srgb, ${brand.accent} 14%, var(--bg-surface))`,
  };
}

/** A logo URL that is safe to put in an <img>: https, http (local development) or a site path. */
export function safeLogoUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  if (u === "") return null;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** One or two capital letters for a tenant without a logo ("Acme Lending Co" -> "AL"). */
export function initialsOfName(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const significant = words.filter((w) => !["of", "the", "and", "&"].includes(w.toLowerCase()));
  const use = significant.length > 0 ? significant : words;
  const letters = use.length > 1 ? use[0][0] + use[1][0] : (use[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
