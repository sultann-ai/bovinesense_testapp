import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_MAX_AGE_MS, summarizeJobs, type JobRow } from "../src/lib/health";

const NOW = new Date("2026-10-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const OFFLINE = "bovinesense-check-offline-tags";
const RETENTION = "bovinesense-fix-retention";
const job = (name: string, ageMs: number | null, status: string | null = "succeeded"): JobRow => ({
  job_name: name, last_run_at: ageMs === null ? null : ago(ageMs), last_status: status,
});

describe("summarizeJobs", () => {
  it("is ok when jobs ran recently and succeeded", () => {
    expect(summarizeJobs([job(OFFLINE, 5 * MIN), job(RETENTION, 10 * HOUR)], NOW)).toBe("ok");
  });

  it("is unknown when there is nothing to judge: no jobs, or none has run yet", () => {
    expect(summarizeJobs([], NOW)).toBe("unknown");
    expect(summarizeJobs([job(OFFLINE, null, null), job(RETENTION, null, null)], NOW)).toBe("unknown");
  });

  it("is ok when the frequent job runs and the nightly one has not had its first night yet", () => {
    expect(summarizeJobs([job(OFFLINE, 3 * MIN), job(RETENTION, null, null)], NOW)).toBe("ok");
  });

  it("is stale once a job has not run for much longer than its schedule", () => {
    expect(summarizeJobs([job(OFFLINE, 46 * MIN), job(RETENTION, HOUR)], NOW)).toBe("stale");
    expect(summarizeJobs([job(OFFLINE, MIN), job(RETENTION, 27 * HOUR)], NOW)).toBe("stale");
  });

  it("allows each job up to its limit, no more", () => {
    expect(summarizeJobs([job(OFFLINE, JOB_MAX_AGE_MS[OFFLINE])], NOW)).toBe("ok");
    expect(summarizeJobs([job(OFFLINE, JOB_MAX_AGE_MS[OFFLINE] + 1)], NOW)).toBe("stale");
    expect(summarizeJobs([job(RETENTION, JOB_MAX_AGE_MS[RETENTION])], NOW)).toBe("ok");
    expect(summarizeJobs([job(RETENTION, JOB_MAX_AGE_MS[RETENTION] + 1)], NOW)).toBe("stale");
  });

  it("is failing when a job's last run failed, even if it ran a moment ago", () => {
    expect(summarizeJobs([job(OFFLINE, MIN, "failed"), job(RETENTION, HOUR)], NOW)).toBe("failing");
  });

  it("failing outranks stale", () => {
    expect(summarizeJobs([job(OFFLINE, 5 * HOUR), job(RETENTION, HOUR, "failed")], NOW)).toBe("failing");
  });

  it("a run that is still going counts as running, not as failed", () => {
    expect(summarizeJobs([job(OFFLINE, MIN, "running")], NOW)).toBe("ok");
  });

  it("ignores jobs that are not BovineSense's and unparseable times", () => {
    expect(summarizeJobs([job("someone-elses-job", 100 * HOUR, "failed")], NOW)).toBe("unknown");
    expect(summarizeJobs([{ job_name: OFFLINE, last_run_at: "not a date", last_status: "succeeded" }], NOW)).toBe("unknown");
  });

  it("uses the current time by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      expect(summarizeJobs([job(OFFLINE, 2 * MIN)])).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── the route ───────────────────────────────────────────────────────────────────────────────────
interface Rpc { data: unknown; error: unknown }
const rpcs: Record<string, Rpc> = {};
const rpcCalls: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (rpcs.__throw) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    return {
      rpc: async (name: string) => {
        rpcCalls.push(name);
        return rpcs[name] ?? { data: null, error: { message: "missing" } };
      },
    };
  },
}));

async function freshRoute() {
  vi.resetModules();
  return import("../src/app/api/health/route");
}

describe("GET /api/health", () => {
  beforeEach(() => {
    for (const k of Object.keys(rpcs)) delete rpcs[k];
    rpcCalls.length = 0;
    rpcs.health_ping = { data: { ok: true, server_time: "2026-10-10T12:00:00Z" }, error: null };
    rpcs.background_job_status = { data: [], error: null };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("answers 200 ok when the database answers (jobs unknown when pg_cron is not there)", async () => {
    const { GET } = await freshRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", database: "ok", background_jobs: "unknown" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does a real database round trip (that is what counts as project activity)", async () => {
    const { GET } = await freshRoute();
    await GET();
    expect(rpcCalls.sort()).toEqual(["background_job_status", "health_ping"]);
  });

  it("reports healthy jobs", async () => {
    rpcs.background_job_status = { data: [job(OFFLINE, 2 * MIN)].map((j) => ({ ...j, last_run_at: new Date(Date.now() - 2 * MIN).toISOString() })), error: null };
    const { GET } = await freshRoute();
    expect(await (await GET()).json()).toMatchObject({ background_jobs: "ok" });
  });

  it("answers 503 degraded when a job has stopped running or failed", async () => {
    rpcs.background_job_status = { data: [{ job_name: OFFLINE, last_run_at: new Date(Date.now() - 5 * HOUR).toISOString(), last_status: "succeeded" }], error: null };
    let route = await freshRoute();
    let res = await route.GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded", database: "ok", background_jobs: "stale" });

    rpcs.background_job_status = { data: [{ job_name: OFFLINE, last_run_at: new Date().toISOString(), last_status: "failed" }], error: null };
    route = await freshRoute();
    res = await route.GET();
    expect(res.status).toBe(503);
    expect((await res.json()).background_jobs).toBe("failing");
  });

  it("a missing job-status function is 'unknown', never 'database down'", async () => {
    rpcs.background_job_status = { data: null, error: { message: "function does not exist" } };
    const { GET } = await freshRoute();
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).background_jobs).toBe("unknown");
  });

  it("answers 503 down when the database cannot be reached, without leaking why", async () => {
    rpcs.health_ping = { data: null, error: { message: 'connection to "db.secret-ref.supabase.co" refused' } };
    const { GET } = await freshRoute();
    const res = await GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toContain('"status":"down"');
    expect(text).not.toContain("secret-ref");
  });

  it("answers 503 down (not a crash) when the server is not configured", async () => {
    rpcs.__throw = { data: null, error: null };
    const { GET } = await freshRoute();
    const res = await GET();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("SERVICE_ROLE");
  });

  it("answers repeated requests from a 5-second memo, so a flood cannot become a flood of database calls", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    const { GET } = await freshRoute();
    await GET();
    for (let i = 0; i < 50; i++) await GET();
    expect(rpcCalls).toHaveLength(2); // one check = two calls

    vi.setSystemTime(new Date("2026-10-10T12:00:06Z"));
    await GET();
    expect(rpcCalls).toHaveLength(4);
  });

  it("HEAD gives the same status with no body", async () => {
    const { HEAD } = await freshRoute();
    const res = await HEAD();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("reveals nothing beyond a few fixed fields", async () => {
    const { GET } = await freshRoute();
    const body = await (await GET()).json();
    expect(Object.keys(body).sort()).toEqual(["background_jobs", "checked_at", "database", "latency_ms", "status"]);
  });
});
