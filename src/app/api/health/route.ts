/**
 * GET /api/health: a lightweight liveness check, public on purpose (no session, no key).
 *
 *   200 { status: "ok", database: "ok", background_jobs: "ok" | "unknown", latency_ms, checked_at }
 *   503 { status: "degraded", ..., background_jobs: "stale" | "failing" }   the app and database are
 *                                                                          up, but a pg_cron job is not running
 *   503 { status: "down", database: "down" }                               the database cannot be reached
 *
 * It does a real round trip to the database (one tiny function call plus the last pg_cron run of
 * each job), so pinging it regularly counts as project activity: that is what keeps a free-tier
 * Supabase project from pausing (see README, "Keeping a pilot awake"). It reveals no names, counts,
 * versions or error text, and answers from a 5-second memo so a flood of requests cannot turn into
 * a flood of database calls.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeJobs, type JobRow } from "@/lib/health";

export const dynamic = "force-dynamic";

const MEMO_MS = 5_000;
let memo: { at: number; status: number; body: Record<string, unknown> } | null = null;

const HEADERS = { "Cache-Control": "no-store" } as const;

async function check(): Promise<{ status: number; body: Record<string, unknown> }> {
  const startedAt = Date.now();
  try {
    const db = createAdminClient();
    const [ping, jobs] = await Promise.all([db.rpc("health_ping"), db.rpc("background_job_status")]);
    if (ping.error) throw ping.error;

    // A missing or failing job-status function (migration not applied, pg_cron not installed)
    // is "unknown", never a reason to report the database as down.
    const background = jobs.error ? "unknown" : summarizeJobs((jobs.data ?? []) as JobRow[]);
    const degraded = background === "stale" || background === "failing";

    return {
      status: degraded ? 503 : 200,
      body: {
        status: degraded ? "degraded" : "ok",
        database: "ok",
        background_jobs: background,
        latency_ms: Date.now() - startedAt,
        checked_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.error("[api/health]", err instanceof Error ? err.message : "check failed");
    return {
      status: 503,
      body: { status: "down", database: "down", checked_at: new Date().toISOString() },
    };
  }
}

export async function GET() {
  if (!memo || Date.now() - memo.at > MEMO_MS) {
    const result = await check();
    memo = { at: Date.now(), ...result };
  }
  return NextResponse.json(memo.body, { status: memo.status, headers: HEADERS });
}

export async function HEAD() {
  const res = await GET();
  return new NextResponse(null, { status: res.status, headers: HEADERS });
}
