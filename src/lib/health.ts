/**
 * Turns pg_cron's "last run of each BovineSense job" into one word for /api/health.
 * Pure and unit-tested (tests/health.test.ts).
 *
 *   ok        every job that has run did so recently and succeeded
 *   stale     a job has not run for much longer than its schedule: pg_cron or the job is stuck
 *   failing   a job's last run failed
 *   unknown   nothing to judge: pg_cron is not installed, the jobs are not scheduled, or none has run yet
 */
export type JobHealth = "ok" | "stale" | "failing" | "unknown";

export interface JobRow {
  job_name: string;
  last_run_at: string | null;
  last_status: string | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long a job may go without running before it counts as stale (about 3x its schedule). */
export const JOB_MAX_AGE_MS: Record<string, number> = {
  "bovinesense-check-offline-tags": 45 * MINUTE, // runs every 15 minutes
  "bovinesense-fix-retention": 26 * HOUR, // runs nightly
};

export function summarizeJobs(rows: readonly JobRow[], now: Date = new Date()): JobHealth {
  let anyOk = false;
  let anyStale = false;

  for (const row of rows) {
    const maxAge = JOB_MAX_AGE_MS[row.job_name];
    if (maxAge === undefined) continue; // not one of ours
    if (row.last_status === "failed") return "failing";
    if (row.last_run_at === null) continue; // scheduled, not run yet
    const age = now.getTime() - new Date(row.last_run_at).getTime();
    if (Number.isNaN(age)) continue;
    if (age > maxAge) anyStale = true;
    else anyOk = true;
  }

  if (anyStale) return "stale";
  return anyOk ? "ok" : "unknown";
}
