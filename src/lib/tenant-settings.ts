/**
 * What the app reads from an organization row to present itself as that tenant. Pure and
 * client-safe (the server parses; the result is handed to client components).
 *
 *   organizations.logo_url                          the logo shown in the top bar
 *   organizations.brand_settings.accent             optional accent colour (brand tokens only)
 *   organizations.settings.timezone                 IANA name, default Asia/Karachi
 *   organizations.settings.demo_mode                true shows the demo banner
 *   organizations.settings.demo_banner              optional text that replaces the generated banner
 *   organizations.settings.alert_rules.offline_threshold_hours   default 6 (what "offline" means here)
 */
import { parseBrand, safeLogoUrl, type Brand } from "./branding";
import { resolveTimezone } from "./format";

export const DEFAULT_OFFLINE_THRESHOLD_HOURS = 6;

export interface TenantSettings {
  timezone: string;
  demoMode: boolean;
  /** Custom banner text, or null to generate it from the tenant's tag counts. */
  demoBannerText: string | null;
  offlineThresholdHours: number;
  brand: Brand;
  logoUrl: string | null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseTenantSettings(input: { settings: unknown; brandSettings: unknown; logoUrl: unknown }): TenantSettings {
  const settings = asRecord(input.settings);
  const rules = asRecord(settings.alert_rules);
  const hours = rules.offline_threshold_hours;
  const banner = typeof settings.demo_banner === "string" ? settings.demo_banner.trim() : "";
  return {
    timezone: resolveTimezone(settings.timezone),
    demoMode: settings.demo_mode === true,
    demoBannerText: banner === "" ? null : banner.slice(0, 200),
    offlineThresholdHours: typeof hours === "number" && Number.isFinite(hours) && hours >= 1 ? hours : DEFAULT_OFFLINE_THRESHOLD_HOURS,
    brand: parseBrand(input.brandSettings),
    logoUrl: safeLogoUrl(input.logoUrl),
  };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/**
 * "Demo environment: 1 live tag, 240 simulated animals." (DESIGN.md §8), built from the tenant's own
 * counts so it stays true; `custom` replaces it entirely.
 */
export function demoBannerMessage(counts: { liveTags: number; simulatedAnimals: number }, custom: string | null): string {
  if (custom) return custom;
  return `Demo environment: ${plural(counts.liveTags, "live tag", "live tags")}, ${plural(counts.simulatedAnimals, "simulated animal", "simulated animals")}.`;
}
