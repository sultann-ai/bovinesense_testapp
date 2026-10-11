/**
 * A small fixed-window rate limiter, in memory.
 *
 * Honest limits: the counters live in one server instance. On serverless hosting (Vercel) each warm
 * instance counts on its own, so the real ceiling is "limit x instances". That is enough to stop a
 * key-guessing loop or a runaway device from hammering one instance, which is what it is for; it is
 * not a hard global quota. A shared limit needs a shared store (not added: Supabase is the only backend).
 */
interface Window { start: number; count: number }

const windows = new Map<string, Window>();
const MAX_TRACKED = 10_000;

export interface LimitResult { allowed: boolean; retryAfterSeconds: number }

/** Counts one hit for `key`; allowed while the hits in the current window stay within `limit`. */
export function hit(key: string, limit: number, windowMs: number, now: number = Date.now()): LimitResult {
  let w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    if (windows.size >= MAX_TRACKED) {
      // Drop expired windows; if that is not enough, start over rather than grow without bound.
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
      if (windows.size >= MAX_TRACKED) windows.clear();
    }
    w = { start: now, count: 0 };
    windows.set(key, w);
  }
  w.count += 1;
  return { allowed: w.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) };
}

/** Looks at the counter without counting a hit. */
export function isBlocked(key: string, limit: number, windowMs: number, now: number = Date.now()): LimitResult {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) return { allowed: true, retryAfterSeconds: 1 };
  return { allowed: w.count < limit, retryAfterSeconds: Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) };
}

export function resetRateLimits(): void {
  windows.clear();
}

/** The caller's address as the platform reports it (first entry of x-forwarded-for). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
