/**
 * Route-level tests for POST /api/ingest/fix with a fake admin client: authentication, validation,
 * the response contract and tenant derivation. (The rules themselves are tested
 * against the real SQL in tests/db/ingest.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { generateDeviceKey, hashDeviceKey } from "../src/lib/device-keys";
import { resetRateLimits } from "../src/lib/rate-limit";

const ORG = "11111111-1111-4111-8111-111111111111";
const KEY_ID = "22222222-2222-4222-8222-222222222222";

interface Fake {
  keyRow: { id: string; organization_id: string; revoked_at: string | null } | null;
  keyError: unknown;
  rpcResult: { data: unknown; error: unknown };
  fromCalls: string[];
  eqCalls: Array<[string, unknown]>;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

const fake: Fake = {
  keyRow: null, keyError: null, rpcResult: { data: null, error: null },
  fromCalls: [], eqCalls: [], rpcCalls: [],
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      fake.fromCalls.push(table);
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          fake.eqCalls.push([col, val]);
          return chain;
        },
        maybeSingle: async () => ({ data: fake.keyRow, error: fake.keyError }),
      };
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      fake.rpcCalls.push({ name, args });
      return fake.rpcResult;
    },
  }),
}));

import { POST } from "../src/app/api/ingest/fix/route";

const goodKey = generateDeviceKey();
const validBody = () => ({
  tag_serial: "TAG-00001",
  lat: 31.55,
  lon: 74.35,
  fixed_at: new Date().toISOString(),
  speed_kmh: 4,
  battery_pct: 80,
  signal_bars: 3,
});

function call(body: unknown, headers: Record<string, string> = { "x-api-key": goodKey.key }, raw = false) {
  return POST(
    new NextRequest("http://localhost/api/ingest/fix", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}

const okResult = (over: Record<string, unknown> = {}) => ({
  data: {
    fix_id: 7, tag_id: 3, animal_id: 5, branch_id: 2, region_id: 1,
    latest: true, duplicate: false, alerts: [], alerts_raised: 0, ...over,
  },
  error: null,
});

beforeEach(() => {
  resetRateLimits();
  fake.keyRow = { id: KEY_ID, organization_id: ORG, revoked_at: null };
  fake.keyError = null;
  fake.rpcResult = okResult();
  fake.fromCalls = [];
  fake.eqCalls = [];
  fake.rpcCalls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("rate limits (429)", () => {
  it("turns an address away after 30 rejected keys in a minute, and says when to retry", async () => {
    fake.keyRow = null; // every well-formed key is unknown
    for (let i = 0; i < 30; i++) expect((await call(validBody(), { "x-api-key": generateDeviceKey().key })).status).toBe(401);
    const res = await call(validBody(), { "x-api-key": generateDeviceKey().key });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // even the right key is refused from that address until the minute is over
    fake.keyRow = { id: KEY_ID, organization_id: ORG, revoked_at: null };
    expect((await call(validBody())).status).toBe(429);
  });

  it("limits one key per minute, and leaves other keys alone", async () => {
    vi.stubEnv("INGEST_RATE_LIMIT_PER_MIN", "3");
    try {
      for (let i = 0; i < 3; i++) expect((await call(validBody())).status).toBe(201);
      expect((await call(validBody())).status).toBe(429);
      fake.keyRow = { id: "33333333-3333-4333-8333-333333333333", organization_id: ORG, revoked_at: null };
      expect((await call(validBody())).status).toBe(201);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("authentication (401)", () => {
  it("rejects a request with no key, without touching the database", async () => {
    const res = await call(validBody(), {});
    expect(res.status).toBe(401);
    expect(fake.fromCalls).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("rejects a malformed key without touching the database (the old shared key shape is dead)", async () => {
    for (const key of ["dev-ingest-key", "", "bsk_short", "x".repeat(300)]) {
      const res = await call(validBody(), { "x-api-key": key });
      expect(res.status, key).toBe(401);
    }
    expect(fake.fromCalls).toEqual([]);
  });

  it("looks the key up by its SHA-256 hash and never sends the plain key to the database", async () => {
    await call(validBody());
    expect(fake.fromCalls).toEqual(["device_api_keys"]);
    expect(fake.eqCalls).toEqual([["key_hash", hashDeviceKey(goodKey.key)]]);
    expect(JSON.stringify([fake.eqCalls, fake.rpcCalls])).not.toContain(goodKey.key);
  });

  it("rejects an unknown key", async () => {
    fake.keyRow = null;
    const res = await call(validBody());
    expect(res.status).toBe(401);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("rejects a revoked key, with the same answer as an unknown one", async () => {
    fake.keyRow = { id: KEY_ID, organization_id: ORG, revoked_at: "2026-10-01T00:00:00Z" };
    const revoked = await call(validBody());
    fake.keyRow = null;
    const unknown = await call(validBody());
    expect(revoked.status).toBe(401);
    expect(await revoked.json()).toEqual(await unknown.json());
    expect(fake.rpcCalls).toEqual([]);
  });

  it("answers 401 when the database says the key stopped being valid mid-request", async () => {
    fake.rpcResult = { data: null, error: { code: "28000", message: "invalid_key" } };
    expect((await call(validBody())).status).toBe(401);
  });

  it("answers 500 (not 401) when the key lookup itself fails", async () => {
    fake.keyError = { code: "XX000", message: "db down" };
    expect((await call(validBody())).status).toBe(500);
  });
});

describe("validation (400)", () => {
  it("rejects invalid JSON", async () => {
    const res = await call("{not json", undefined, true);
    expect(res.status).toBe(400);
    expect(fake.rpcCalls).toEqual([]);
  });

  const cases: Array<[string, Record<string, unknown>]> = [
    ["missing tag_serial", { tag_serial: undefined }],
    ["empty tag_serial", { tag_serial: "" }],
    ["tag_serial over 50 characters", { tag_serial: "x".repeat(51) }],
    ["latitude above 90", { lat: 90.1 }],
    ["longitude below -180", { lon: -180.1 }],
    ["non-numeric latitude", { lat: "31.5" }],
    ["fixed_at without a UTC offset", { fixed_at: "2026-10-09T10:00:00" }],
    ["fixed_at not a date", { fixed_at: "yesterday" }],
    ["fixed_at in the future", { fixed_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() }],
    ["negative speed", { speed_kmh: -1 }],
    ["battery above 100", { battery_pct: 101 }],
    ["fractional battery", { battery_pct: 50.5 }],
    ["signal above 4", { signal_bars: 5 }],
  ];
  for (const [name, patch] of cases) {
    it(`rejects ${name}`, async () => {
      const res = await call({ ...validBody(), ...patch });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Validation failed");
      expect(fake.rpcCalls).toEqual([]);
    });
  }

  it("accepts the optional fields being absent, and a fix a few seconds ahead (clock skew)", async () => {
    const { speed_kmh, battery_pct, signal_bars, ...minimal } = validBody();
    void speed_kmh; void battery_pct; void signal_bars;
    expect((await call(minimal)).status).toBe(201);
    expect((await call({ ...minimal, fixed_at: new Date(Date.now() + 30_000).toISOString() })).status).toBe(201);
  });

  it("authenticates before it validates (an unauthenticated caller learns nothing about the schema)", async () => {
    const res = await call({ nonsense: true }, {});
    expect(res.status).toBe(401);
  });
});

describe("success (201) and the response contract", () => {
  it("returns exactly fix_id, animal_id and alerts_raised", async () => {
    fake.rpcResult = okResult({ alerts: [{ id: 1, type: "breach", severity: "critical" }], alerts_raised: 1 });
    const res = await call(validBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ fix_id: 7, animal_id: 5, alerts_raised: 1 });
  });

  it("takes the organization from the key, never from the request body", async () => {
    const OTHER = "99999999-9999-4999-8999-999999999999";
    await call({ ...validBody(), organization_id: OTHER, organizationId: OTHER });
    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0].name).toBe("ingest_fix");
    expect(fake.rpcCalls[0].args).toMatchObject({ p_organization_id: ORG, p_device_key_id: KEY_ID, p_tag_serial: "TAG-00001" });
    expect(JSON.stringify(fake.rpcCalls[0].args)).not.toContain(OTHER);
  });

  it("passes the reading through to the database function", async () => {
    const body = validBody();
    await call(body);
    expect(fake.rpcCalls[0].args).toMatchObject({
      p_lat: 31.55, p_lon: 74.35, p_fixed_at: body.fixed_at, p_speed_kmh: 4, p_battery_pct: 80, p_signal_bars: 3,
    });
  });

  it("a retransmitted fix is still a 201 with the same ids and no alerts", async () => {
    fake.rpcResult = okResult({ duplicate: true, latest: false });
    const res = await call(validBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ fix_id: 7, animal_id: 5, alerts_raised: 0 });
  });
});

describe("not found (404)", () => {
  it("unknown tag, or a tag of another organization", async () => {
    fake.rpcResult = { data: null, error: { code: "P0002", message: "tag_not_found" } };
    const res = await call(validBody());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Tag 'TAG-00001' not found");
  });

  it("a tag that is not assigned to an animal", async () => {
    fake.rpcResult = { data: null, error: { code: "P0002", message: "animal_not_found" } };
    const res = await call(validBody());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("No animal assigned to tag 'TAG-00001'");
  });
});

describe("internal errors (500)", () => {
  it("do not leak database internals", async () => {
    fake.rpcResult = { data: null, error: { code: "XX000", message: 'relation "secret_table" does not exist' } };
    const res = await call(validBody());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret_table");
  });
});
