/**
 * Guards for the map code: the Google API key is never written into source, and the map components
 * take every colour from the CSS tokens in globals.css (project rule: never hardcode hex in components).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === ".next" || name === ".git") return [];
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

const rel = (p: string) => path.relative(ROOT, p).replaceAll("\\", "/");
const read = (p: string) => readFileSync(p, "utf8");

describe("no Google API key in the repository", () => {
  // A Google API key is "AIza" followed by 35 URL-safe characters.
  const KEY = /AIza[0-9A-Za-z_-]{35}/;
  const scanned = ["src", "tests", "docs", "scripts", "supabase"].flatMap((d) => filesUnder(path.join(ROOT, d)));

  it("scans a meaningful number of files", () => {
    expect(scanned.length).toBeGreaterThan(50);
  });

  it("finds no key in source, tests, docs, scripts or migrations", () => {
    const hits = scanned.filter((f) => !f.endsWith("maps-no-secrets.test.ts") && KEY.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it("the key is only ever read from the environment, in one place", () => {
    const users = filesUnder(path.join(ROOT, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f) && read(f).includes("process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"))
      .map(rel);
    expect(users).toEqual(["src/lib/maps/config.ts"]);
  });

  it("the pattern really matches a key-shaped string (the guard can fail)", () => {
    expect(KEY.test("AIza" + "A".repeat(35))).toBe(true);
    expect(KEY.test("AIza-too-short")).toBe(false);
  });
});

describe("no hardcoded colours in the map components", () => {
  const HEX = /#[0-9a-fA-F]{3,8}\b/;
  const files = filesUnder(path.join(ROOT, "src/components/map")).filter((f) => /\.(ts|tsx)$/.test(f));

  it("scans the map components", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("uses CSS tokens, not hex literals", () => {
    const offenders = files.flatMap((f) =>
      read(f)
        .split("\n")
        .map((line, i) => ({ f, line, n: i + 1 }))
        .filter(({ line }) => HEX.test(line))
        .map(({ f: file, n, line }) => `${rel(file)}:${n}  ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the pattern really matches a colour (the guard can fail)", () => {
    expect(HEX.test('fill="#3E7C59"')).toBe(true);
    expect(HEX.test("var(--status-inside)")).toBe(false);
  });
});
