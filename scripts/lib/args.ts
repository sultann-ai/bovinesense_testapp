/**
 * Command-line parsing for the simulator. Pure, so it is unit-tested (tests/simulate-args.test.ts).
 *
 *   simulate [scenario | --scenario=<scenario>] [--org <slug>] [--key <device key>] [--url <ingest url>]
 *
 * `--flag value` and `--flag=value` are both accepted. The scenario is the one bare word.
 */
export const SCENARIOS = ["breach", "fast", "offline"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface SimArgs {
  scenario: Scenario | null;
  org: string | null;
  key: string | null;
  url: string | null;
  help: boolean;
}

const VALUE_FLAGS = ["org", "key", "url"] as const;

/** Names accepted for a scenario: the short names, plus the demo-script spelling "fast-movement". */
function toScenario(word: string): Scenario | null {
  const s = word.toLowerCase();
  const name = s === "fast-movement" ? "fast" : s;
  return (SCENARIOS as readonly string[]).includes(name) ? (name as Scenario) : null;
}

export function parseSimArgs(argv: readonly string[]): { ok: true; args: SimArgs } | { ok: false; error: string } {
  const args: SimArgs = { scenario: null, org: null, key: null, url: null, help: false };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const inline = eq === -1 ? undefined : token.slice(eq + 1);
      if (name === "scenario") {
        const value = inline !== undefined ? inline : argv[++i];
        const scenario = value ? toScenario(value) : null;
        if (!scenario) return { ok: false, error: `--scenario needs one of: ${SCENARIOS.join(", ")}, fast-movement.` };
        args.scenario = scenario;
        continue;
      }
      if (!(VALUE_FLAGS as readonly string[]).includes(name)) {
        return { ok: false, error: `Unknown option --${name}.` };
      }
      const value = inline !== undefined ? inline : argv[++i];
      if (value === undefined || value === "" || value.startsWith("--")) {
        return { ok: false, error: `--${name} needs a value.` };
      }
      args[name as (typeof VALUE_FLAGS)[number]] = value;
      continue;
    }
    positionals.push(token);
  }

  if (positionals.length > 1) {
    return { ok: false, error: `Expected at most one scenario, got: ${positionals.join(", ")}.` };
  }
  if (positionals.length === 1) {
    const scenario = toScenario(positionals[0]);
    if (!scenario) {
      return { ok: false, error: `Unknown scenario '${positionals[0]}'. Use one of: ${SCENARIOS.join(", ")}.` };
    }
    args.scenario = scenario;
  }
  return { ok: true, args };
}
