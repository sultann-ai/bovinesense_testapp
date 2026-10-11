import { describe, expect, it } from "vitest";
import { parseSimArgs } from "../scripts/lib/args";

const ok = (argv: string[]) => {
  const r = parseSimArgs(argv);
  if (!r.ok) throw new Error(r.error);
  return r.args;
};
const err = (argv: string[]) => {
  const r = parseSimArgs(argv);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("simulator arguments", () => {
  it("defaults to no scenario, no organization, no key", () => {
    expect(ok([])).toEqual({ scenario: null, org: null, key: null, url: null, help: false });
  });

  it("reads a scenario, case-insensitively", () => {
    expect(ok(["breach"]).scenario).toBe("breach");
    expect(ok(["FAST"]).scenario).toBe("fast");
    expect(ok(["offline"]).scenario).toBe("offline");
  });

  it("reads --scenario=name, and fast-movement as fast", () => {
    expect(ok(["--scenario=breach"]).scenario).toBe("breach");
    expect(ok(["--scenario", "fast-movement"]).scenario).toBe("fast");
    expect(ok(["fast-movement"]).scenario).toBe("fast");
    expect(err(["--scenario=nope"])).toMatch(/--scenario needs one of/);
  });

  it("reads --org in either position and in both spellings", () => {
    expect(ok(["--org", "demo-bank"]).org).toBe("demo-bank");
    expect(ok(["--org=demo-bank", "breach"])).toMatchObject({ org: "demo-bank", scenario: "breach" });
    expect(ok(["breach", "--org", "bank-of-punjab"])).toMatchObject({ org: "bank-of-punjab", scenario: "breach" });
  });

  it("reads --key and --url, keeping '=' signs inside the value", () => {
    expect(ok(["--key", "bsk_abc"]).key).toBe("bsk_abc");
    expect(ok(["--url=http://x/api/ingest/fix?a=b"]).url).toBe("http://x/api/ingest/fix?a=b");
  });

  it("does not mistake a flag's value for the scenario", () => {
    expect(ok(["--org", "breach"]).scenario).toBeNull();
  });

  it("rejects unknown scenarios, unknown options, missing values and extra words", () => {
    expect(err(["explode"])).toMatch(/Unknown scenario/);
    expect(err(["--organisation", "x"])).toMatch(/Unknown option --organisation/);
    expect(err(["--org"])).toMatch(/--org needs a value/);
    expect(err(["--org", "--key", "k"])).toMatch(/--org needs a value/);
    expect(err(["--org="])).toMatch(/--org needs a value/);
    expect(err(["breach", "fast"])).toMatch(/at most one scenario/);
  });

  it("recognises --help", () => {
    expect(ok(["--help"]).help).toBe(true);
    expect(ok(["-h"]).help).toBe(true);
  });
});
