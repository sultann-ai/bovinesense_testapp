/**
 * POST /api/ingest/fix
 *
 * Single ingestion endpoint for real GPS tags, gateways and the simulator. It has no user session;
 * the caller authenticates with a per-organization device key in the X-Api-Key header (create keys
 * in Settings → Device keys). The key decides the organization: the tag is looked up inside that
 * organization only, so one customer's key can never write to another's animals.
 *
 * The route authenticates and validates; everything else, including the alert rules, happens in
 * ONE database transaction inside public.ingest_fix() (supabase/migrations/…_ingestion.sql).
 * Open dashboards learn about the new fix, alert and status through Supabase Realtime, which
 * streams the rows that transaction wrote (postgres_changes, filtered by Row Level Security);
 * this route notifies nobody itself.
 *
 * Rate limits (in memory, per server instance; see src/lib/rate-limit.ts):
 *   - a caller address that sends `BAD_KEY_LIMIT` requests with a missing / wrong / revoked key in a
 *     minute is answered 429 until the minute is over (stops key guessing);
 *   - each device key may send `INGEST_RATE_LIMIT_PER_MIN` fixes a minute (default 3000, enough for the
 *     240-animal simulator at one fix per animal every 8 s). Raise it with that environment variable.
 *
 * Body (JSON):
 *   tag_serial   string   tag serial number (e.g. "TAG-00001")
 *   lat          number   latitude  (WGS-84)
 *   lon          number   longitude (WGS-84)
 *   fixed_at     string   ISO-8601 timestamp WITH offset when the fix was taken
 *   speed_kmh?   number   speed in km/h
 *   battery_pct? number   0–100
 *   signal_bars? number   0–4
 *
 * Responses:
 *   201 { fix_id, animal_id, alerts_raised }   (a retransmitted fix answers 201 with alerts_raised 0)
 *   400 invalid JSON or body
 *   401 missing, unknown or revoked key
 *   429 too many requests (see "Rate limits" below)
 *   404 tag not found in the key's organization / not assigned to an animal
 *   500 internal error
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorCode, errorMessage } from "@/lib/api-helpers";
import { hashDeviceKey, looksLikeDeviceKey } from "@/lib/device-keys";
import { clientIp, hit, isBlocked } from "@/lib/rate-limit";

const MINUTE_MS = 60_000;
/** Requests with a bad key one address may send per minute before being turned away. */
const BAD_KEY_LIMIT = 30;
const perKeyLimit = () => {
  const n = Number(process.env.INGEST_RATE_LIMIT_PER_MIN);
  return Number.isInteger(n) && n > 0 ? n : 3000;
};

const tooMany = (retryAfterSeconds: number) =>
  NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } });

/** A tag's clock may run a little ahead; a fix further in the future would freeze the animal. */
const MAX_FUTURE_MS = 5 * 60 * 1000;

const FixSchema = z.object({
  tag_serial:  z.string().min(1).max(50),
  lat:         z.number().min(-90).max(90),
  lon:         z.number().min(-180).max(180),
  fixed_at:    z.string().datetime({ offset: true }).refine(
    (v) => Date.parse(v) <= Date.now() + MAX_FUTURE_MS,
    "fixed_at is in the future",
  ),
  speed_kmh:   z.number().nonnegative().optional(),
  battery_pct: z.number().int().min(0).max(100).optional(),
  signal_bars: z.number().int().min(0).max(4).optional(),
});

/** What public.ingest_fix() returns (only the fields this route uses). */
interface IngestResult {
  fix_id: number;
  animal_id: number;
  alerts_raised: number;
}

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/** A rejected key counts against the caller's address; past the limit it gets 429 instead of 401. */
function rejectKey(ip: string) {
  const r = hit(`badkey:${ip}`, BAD_KEY_LIMIT, MINUTE_MS);
  return r.allowed ? unauthorized() : tooMany(r.retryAfterSeconds);
}

export async function POST(req: NextRequest) {
  // 1. Authenticate. Shape check first (no database work for garbage), then the hash lookup.
  const ip = clientIp(req.headers);
  const blocked = isBlocked(`badkey:${ip}`, BAD_KEY_LIMIT, MINUTE_MS);
  if (!blocked.allowed) return tooMany(blocked.retryAfterSeconds);

  const apiKey = req.headers.get("x-api-key");
  if (!looksLikeDeviceKey(apiKey)) return rejectKey(ip);

  // 2. Parse and validate the body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = FixSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  try {
    const db = createAdminClient();

    // 3. Look the key up by its hash. Unknown and revoked are indistinguishable to the caller.
    const { data: key, error: keyError } = await db
      .from("device_api_keys")
      .select("id, organization_id, revoked_at")
      .eq("key_hash", hashDeviceKey(apiKey))
      .maybeSingle();
    if (keyError) throw keyError;
    if (!key || key.revoked_at !== null) return rejectKey(ip);

    const limit = hit(`key:${key.id}`, perKeyLimit(), MINUTE_MS);
    if (!limit.allowed) return tooMany(limit.retryAfterSeconds);

    // 4. Insert the fix and run the alert rules, atomically, inside the key's organization.
    const { data: raw, error: rpcError } = await db.rpc("ingest_fix", {
      p_organization_id: key.organization_id,
      p_device_key_id:   key.id,
      p_tag_serial:      data.tag_serial,
      p_lat:             data.lat,
      p_lon:             data.lon,
      p_fixed_at:        data.fixed_at,
      p_speed_kmh:       data.speed_kmh,
      p_battery_pct:     data.battery_pct,
      p_signal_bars:     data.signal_bars,
    });
    if (rpcError) {
      const code = errorCode(rpcError);
      const message = errorMessage(rpcError);
      if (code === "28000") return unauthorized(); // key revoked / org suspended since step 3
      if (code === "P0002" && message.includes("animal_not_found")) {
        return NextResponse.json(
          { error: `No animal assigned to tag '${data.tag_serial}'` },
          { status: 404 },
        );
      }
      if (code === "P0002") {
        return NextResponse.json({ error: `Tag '${data.tag_serial}' not found` }, { status: 404 });
      }
      throw rpcError;
    }
    const result = raw as unknown as IngestResult;

    return NextResponse.json(
      { fix_id: result.fix_id, animal_id: result.animal_id, alerts_raised: result.alerts_raised },
      { status: 201 },
    );
  } catch (err) {
    // Never echo database internals to an unauthenticated-by-session caller.
    console.error("[ingest/fix]", errorMessage(err));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
