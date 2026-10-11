/**
 * Guards for the app shell:
 *  - no tenant is hardcoded in code or copy (a tenant's name, logo, regions, branches come from data);
 *  - components use the colour tokens, never a literal colour, and never a looping animation;
 *  - screens are assembled from components/ui: raw <button> elements exist only where a primitive
 *    needs one (a Radix trigger, a list option, a text link-button, the rail's collapse toggle).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}
const rel = (p: string) => path.relative(ROOT, p).replaceAll("\\", "/");
const read = (p: string) => readFileSync(p, "utf8");

const sources = filesUnder(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !rel(f).startsWith("src/types/"));
const components = sources.filter((f) => f.endsWith(".tsx"));

describe("no tenant is hardcoded", () => {
  const PATTERNS: Array<[string, RegExp]> = [
    ["Bank of Punjab", /bank of punjab/i],
    ["bank-of-punjab", /bank-of-punjab/i],
    ["BOP", /\bBOP\b/],
    ["Demo Bank", /demo bank/i],
    ["bank-specific wording", /moved_with_bank|with bank consent/i],
  ];

  it.each(PATTERNS)("%s appears nowhere in src", (_name, re) => {
    const hits = sources.filter((f) => re.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("the top bar, rail and banner contain no region or branch names", () => {
    for (const f of ["TopBar.tsx", "Sidebar.tsx", "ScopeSelector.tsx", "DemoModeBanner.tsx", "GlobalSearch.tsx"]) {
      const text = read(path.join(SRC, "components/shell", f));
      expect(text, f).not.toMatch(/Lahore|Rawalpindi|Faisalabad|Multan|Gujranwala|Gulberg|DHA|Cantt/);
    }
  });

  it("the demo banner message is not a constant in the component", () => {
    expect(read(path.join(SRC, "components/shell/DemoModeBanner.tsx"))).not.toMatch(/240|1 live tag/);
  });

  it("the boundaries route does not filter to one province", () => {
    expect(read(path.join(SRC, "app/api/boundaries/route.ts"))).not.toMatch(/\.eq\(\s*"province"/);
  });
});

describe("components use tokens and the one allowed animation", () => {
  it("has no literal colour (hex, rgb, hsl) outside globals.css", () => {
    const colour = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
    const hits = sources
      .flatMap((f) => read(f).split("\n").map((line, i) => ({ f, line, n: i + 1 })))
      .filter(({ line }) => colour.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line))
      .map(({ f, n, line }) => `${rel(f)}:${n}  ${line.trim()}`);
    expect(hits).toEqual([]);
  });

  it("has no looping animation in components (the breach pulse lives in globals.css)", () => {
    const hits = components.filter((f) => /animate-(pulse|spin|bounce|ping)/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });
});

describe("screens are built from components/ui", () => {
  /** The only places a raw <button> is justified. */
  const ALLOWED = new Set([
    "src/components/ui/animal-drawer.tsx", // tab buttons of the drawer frame
    "src/components/ui/button.tsx", //       the Button itself
    "src/components/ui/filter-bar.tsx", //   the chip
    "src/components/ui/kpi-card.tsx", //     the card when it filters the map and feed
    "src/components/overview/FilterBar.tsx", // the segmented status control
    "src/components/overview/AlertFeed.tsx", // the "Unacknowledged only" switch
    "src/components/shell/GlobalSearch.tsx", // listbox options
    "src/components/shell/Sidebar.tsx", //   the rail's collapse toggle
    "src/components/shell/TopBar.tsx", //    the Radix trigger of the account menu
    "src/components/ui/alert-feed-item.tsx", // the card's open-the-animal area
    "src/components/auth/fields.tsx", //     the show-password toggle
    "src/components/auth/LoginForm.tsx", //  text link-buttons
    "src/app/(auth)/select-organization/page.tsx", // organization rows
  ]);

  it("raw <button> elements appear only in the allowed primitives", () => {
    const hits = components.filter((f) => /<button[\s>]/.test(read(f))).map(rel).filter((f) => !ALLOWED.has(f));
    expect(hits).toEqual([]);
  });

  it("each page of the shell uses the shared states for loading, empty and error", () => {
    for (const page of ["alerts", "animals"]) {
      const text = read(path.join(SRC, `app/(app)/${page}/page.tsx`));
      expect(text, page).toContain("components/ui/data-table");
      expect(text, page).toContain("EmptyState");
      expect(text, page).toMatch(/onRetry|retry/);
    }
    expect(read(path.join(SRC, "app/(app)/error.tsx"))).toContain("ErrorState");
    expect(read(path.join(SRC, "app/(app)/loading.tsx"))).toContain("Skeleton");
  });

  it("the old per-screen copies of the shared components are gone", () => {
    const text = components.map((f) => ({ f, t: read(f) }));
    // a status pill, battery bar or skeleton row defined inside a screen would be a second copy
    for (const re of [/function StatusPill/, /function BatteryBar/, /function SkeletonRow/, /function AlertCard/, /function Chip/]) {
      const hits = text.filter(({ f, t }) => re.test(t) && !rel(f).startsWith("src/components/ui/")).map(({ f }) => rel(f));
      expect(hits, String(re)).toEqual([]);
    }
  });
});
