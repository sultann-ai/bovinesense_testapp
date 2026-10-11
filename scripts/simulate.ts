/**
 * Bovine Track simulator
 *
 * Usage:
 *   npm run simulate -- --org demo-bank              all of that organization's simulated animals drift
 *   npm run simulate -- --scenario=breach --org bank-of-punjab         one animal walks out of its district
 *   npm run simulate -- --scenario=fast-movement --org bank-of-punjab  one animal moves at 40 km/h
 *   npm run simulate:breach  -- --org demo-bank      trigger a breach scenario
 *   npm run simulate:fast    -- --org demo-bank      trigger a fast-movement scenario
 *   npm run simulate:offline -- --org demo-bank      trigger an offline scenario (stop one tag)
 *
 * Options:
 *   --org <slug>    the organization to simulate. Optional only when exactly one organization has
 *                   simulated animals.
 *   --key <key>     a device key (or set DEVICE_API_KEY). Without one, the simulator creates a
 *                   temporary key for the run and revokes it when it stops.
 *   --url <url>     ingestion endpoint (or set INGEST_URL). Default http://localhost:3000/api/ingest/fix
 *
 * Animals drift slowly inside their districts (a few hundred metres per tick). Each tick sends a
 * fix to POST /api/ingest/fix with the organization's device key, exactly like a real tag, so the
 * demo exercises the real pipeline. Simulated tags are marked is_simulated = true.
 */
import { createScriptClient } from "./lib/supabase";
import { parseSimArgs, SCENARIOS } from "./lib/args";
import { hashDeviceKey, generateDeviceKey, looksLikeDeviceKey } from "../src/lib/device-keys";

// ─── Config ──────────────────────────────────────────────────────────────────
// Each fix is one database call, so cap parallel requests to stay well inside the free plan's
// capacity instead of firing all animals at once.
const CONCURRENCY = 8;
const TICK_MS     = 8_000;           // 8 s between rounds
const DRIFT_KM    = 0.05;            // normal drift per tick (50 m)
const BREACH_KM   = 1.5;             // breach scenario step per tick: crosses a district edge in a few minutes, for a live demo
const FAST_SPEED  = 40;              // km/h for fast scenario
const NORMAL_SPEED = 0.8;            // km/h for normal drift
const EPHEMERAL_LABEL = "Simulator (temporary)";

const HELP = `Usage: npm run simulate -- [${SCENARIOS.join("|")}|--scenario=<name>, fast-movement = fast] [--org <slug>] [--key <device key>] [--url <ingest url>]`;

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const parsedArgs = parseSimArgs(process.argv.slice(2));
if (!parsedArgs.ok) die(`${parsedArgs.error}
${HELP}`);
if (parsedArgs.args.help) {
  console.log(HELP);
  process.exit(0);
}
const SCENARIO   = parsedArgs.args.scenario ?? "";
const INGEST_URL = parsedArgs.args.url ?? process.env.INGEST_URL ?? "http://localhost:3000/api/ingest/fix";

// ─── Scenario animal indices ──────────────────────────────────────────────────
// These are resolved from the DB at startup.
let breachAnimalIdx  = 0;   // index into loaded animals array
let fastAnimalIdx    = 1;
let offlineAnimalIdx = 2;

/** Run `fn` over `items` with at most `limit` in flight, preserving result order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ─── Geo helpers ─────────────────────────────────────────────────────────────
const DEG_PER_KM = 1 / 111.32;

function jitter(km: number): [number, number] {
  const angle  = Math.random() * 2 * Math.PI;
  const distKm = km * (0.5 + Math.random() * 0.5);
  return [
    Math.sin(angle) * distKm * DEG_PER_KM,
    Math.cos(angle) * distKm * DEG_PER_KM,
  ];
}

function moveTowards(
  from:  [number, number],
  to:    [number, number],
  stepKm: number
): [number, number] {
  const dlat  = to[0] - from[0];
  const dlon  = to[1] - from[1];
  const distKm = Math.sqrt(dlat * dlat + dlon * dlon) / DEG_PER_KM;
  if (distKm < stepKm) return to;
  const frac  = stepKm / distKm;
  return [from[0] + dlat * frac, from[1] + dlon * frac];
}

// ─── Animal state ─────────────────────────────────────────────────────────────
interface AnimalState {
  animalId:     number;
  /** The status when the simulator started. Animals that are not "inside" keep the demo's exceptions. */
  status:       string;
  tagId:        number;
  serialNumber: string;
  lat:          number;
  lon:          number;
  district:     string;
  // District approximate centroid + spread for drift clamping
  centreLat:    number;
  centreLon:    number;
  spreadLat:    number;
  spreadLon:    number;
}

const DISTRICT_META: Record<string, { lat: number; lon: number; dlat: number; dlon: number }> = {
  "Lahore":     { lat: 31.52, lon: 74.36, dlat: 0.20, dlon: 0.25 },
  "Faisalabad": { lat: 31.42, lon: 73.08, dlat: 0.28, dlon: 0.32 },
  "Multan":     { lat: 30.16, lon: 71.52, dlat: 0.24, dlon: 0.26 },
  "Sahiwal":    { lat: 30.67, lon: 73.11, dlat: 0.18, dlon: 0.22 },
  "Okara":      { lat: 30.81, lon: 73.45, dlat: 0.16, dlon: 0.20 },
};

// ─── Main ─────────────────────────────────────────────────────────────────────
type Db = ReturnType<typeof createScriptClient>;

/** The organization to simulate: --org, or the only one that has simulated animals. */
async function resolveOrganization(db: Db, slug: string | null): Promise<{ id: string; name: string; slug: string }> {
  if (slug) {
    const { data, error } = await db.from("organizations").select("id, name, slug, status").eq("slug", slug).maybeSingle();
    if (error) throw error;
    if (!data) die(`Organization '${slug}' not found.`);
    if (data.status !== "active") die(`Organization '${slug}' is ${data.status}.`);
    return data;
  }

  const { data: tags, error } = await db.from("tags").select("organization_id").eq("is_simulated", true).limit(1000);
  if (error) throw error;
  const ids = [...new Set(tags.map((t) => t.organization_id))];
  if (ids.length === 0) die("No simulated animals found. Seed the database first (see README).");

  const { data: orgs, error: orgError } = await db.from("organizations").select("id, name, slug").in("id", ids);
  if (orgError) throw orgError;
  if (orgs.length === 1) return orgs[0];
  die(`More than one organization has simulated animals; choose one with --org <slug>: ${orgs.map((o) => o.slug).join(", ")}`);
}

/**
 * The device key to send. A key you supply must be live and belong to the organization (otherwise
 * every request would be a confusing 401/404). With none, a temporary key is created for this run
 * and revoked when the simulator stops.
 */
async function resolveKey(
  db: Db,
  org: { id: string; name: string; slug: string },
  supplied: string | null,
): Promise<{ key: string; cleanup: () => Promise<void> }> {
  if (supplied) {
    if (!looksLikeDeviceKey(supplied)) die("That does not look like a device key (they start with 'bsk_').");
    const { data, error } = await db
      .from("device_api_keys")
      .select("organization_id, revoked_at")
      .eq("key_hash", hashDeviceKey(supplied))
      .maybeSingle();
    if (error) throw error;
    if (!data || data.revoked_at) die("That device key is unknown or has been revoked.");
    if (data.organization_id !== org.id) {
      die(`That device key belongs to a different organization than '${org.slug}'. Use a key created for ${org.name}.`);
    }
    return { key: supplied, cleanup: async () => {} };
  }

  // Tidy up keys left behind by a simulator that was killed without cleaning up.
  await db
    .from("device_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", org.id)
    .eq("label", EPHEMERAL_LABEL)
    .is("revoked_at", null);

  const fresh = generateDeviceKey();
  const { data, error } = await db
    .from("device_api_keys")
    .insert({ organization_id: org.id, key_hash: fresh.hash, key_prefix: fresh.prefix, label: EPHEMERAL_LABEL })
    .select("id")
    .single();
  if (error) throw error;
  console.log(`[simulator] Using a temporary device key for ${org.name} (revoked when the simulator stops).`);

  let done = false;
  return {
    key: fresh.key,
    cleanup: async () => {
      if (done) return;
      done = true;
      await db.from("device_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", data.id).is("revoked_at", null);
    },
  };
}

async function main() {
  const db = createScriptClient();

  const org = await resolveOrganization(db, parsedArgs.ok ? parsedArgs.args.org : null);
  const { key: API_KEY, cleanup } = await resolveKey(
    db,
    org,
    (parsedArgs.ok ? parsedArgs.args.key : null) ?? process.env.DEVICE_API_KEY ?? null,
  );

  pendingCleanup = cleanup;
  let stopping = false;
  async function quit(code: number): Promise<never> {
    if (!stopping) {
      stopping = true;
      try { await cleanup(); } catch (e) { console.error("[simulator] could not revoke the temporary key:", e); }
    }
    process.exit(code);
  }

  // Load this organization's simulated animals with their last fix position
  const { data: rows, error } = await db
    .from("animal_overview")
    .select("id, tag_id, tag_serial, district, lat, lon, status")
    .eq("organization_id", org.id)
    .eq("tag_is_simulated", true)
    .not("tag_serial", "is", null)
    .order("id", { ascending: true })
    .limit(1000); // Supabase max_rows

  if (error) {
    console.error("Could not load simulated animals:", error.message);
    return quit(1);
  }

  if (rows.length === 0) {
    console.error(`No simulated animals found in ${org.name}. Seed the database first (see README).`);
    return quit(1);
  }

  // Build state
  const animals: AnimalState[] = rows.map((r) => {
    const district = r.district ?? "";
    const meta = DISTRICT_META[district] ?? { lat: 31.0, lon: 73.0, dlat: 0.2, dlon: 0.2 };
    return {
      animalId:     r.id as number,
      status:       r.status as string,
      tagId:        r.tag_id as number,
      serialNumber: r.tag_serial as string,
      lat:          r.lat  ?? meta.lat,
      lon:          r.lon  ?? meta.lon,
      district,
      centreLat:    meta.lat,
      centreLon:    meta.lon,
      spreadLat:    meta.dlat,
      spreadLon:    meta.dlon,
    };
  });

  // Scenario animals are the first ones that are currently inside, so a scenario never disturbs the
  // exceptions already on screen (breach, near boundary, fast movement, offline).
  const insideIdx = animals.map((a, i) => (a.status === "inside" ? i : -1)).filter((i) => i >= 0);
  const pick = (n: number) => insideIdx[Math.min(n, insideIdx.length - 1)] ?? Math.min(n, animals.length - 1);
  breachAnimalIdx  = pick(0);
  fastAnimalIdx    = pick(1);
  offlineAnimalIdx = pick(2);
  const held = animals.filter((a) => a.status !== "inside").length;
  if (held > 0) console.log(`[simulator] ${held} animals keep their demo exception (breach / near boundary / fast / offline) and are not moved.`);

  console.log(`[simulator] Loaded ${animals.length} simulated animals in ${org.name}`);
  if (SCENARIO) console.log(`[simulator] Scenario: ${SCENARIO.toUpperCase()}`);

  // Breach scenario: pick a district centroid and walk the animal outside
  // by heading away from the centroid past the boundary.
  const breachTarget: Record<string, [number, number]> = {
    "Lahore":     [31.72, 74.36],   // north of Lahore district
    "Faisalabad": [32.10, 73.08],
    "Multan":     [29.70, 71.52],
    "Sahiwal":    [31.10, 73.11],
    "Okara":      [31.00, 73.45],
  };

  let tick = 0;

  async function doTick() {
    tick++;
    const now    = new Date().toISOString();
    // Offline and fast-movement animals send nothing (an offline tag stays offline, a fast one keeps its
    // alert). Breach and near-boundary animals resend their position so they stay fresh but do not move.
    const batch  = animals.filter((a, i) =>
      a.status !== "stale" && a.status !== "fast" && !(SCENARIO === "offline" && i === offlineAnimalIdx));

    const results = await mapLimit(batch, CONCURRENCY, async (a) => {
      const idx = animals.indexOf(a);
      let lat     = a.lat;
      let lon     = a.lon;
      let speed   = NORMAL_SPEED + Math.random() * 0.5;
      const battery = 60 + Math.floor(Math.random() * 30);

      if (a.status === "breach" || a.status === "near") {
        speed = 0.5; // held where the demo put it
      } else if (SCENARIO === "breach" && idx === breachAnimalIdx) {
        const target = breachTarget[a.district] ?? [a.centreLat + 0.3, a.centreLon];
        const next   = moveTowards([lat, lon], target, BREACH_KM);
        lat   = next[0];
        lon   = next[1];
        speed = 2 + Math.random() * 2; // walking pace
      } else if (SCENARIO === "fast" && idx === fastAnimalIdx) {
        // Head towards a fixed point at vehicle speed
        const target: [number, number] = [a.centreLat + 0.4, a.centreLon + 0.1];
        const next = moveTowards([lat, lon], target, 0.4);
        lat   = next[0];
        lon   = next[1];
        speed = FAST_SPEED + Math.random() * 5;
      } else {
        // Normal drift — small jitter, clamped roughly inside district
        const [dlat, dlon] = jitter(DRIFT_KM);
        lat = Math.max(a.centreLat - a.spreadLat * 0.8, Math.min(a.centreLat + a.spreadLat * 0.8, lat + dlat));
        lon = Math.max(a.centreLon - a.spreadLon * 0.8, Math.min(a.centreLon + a.spreadLon * 0.8, lon + dlon));
      }

      // Update state in place
      a.lat = lat;
      a.lon = lon;

      try {
        const res = await fetch(INGEST_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key":    API_KEY,
          },
          body: JSON.stringify({
            tag_serial:  a.serialNumber,
            lat,
            lon,
            fixed_at:    now,
            speed_kmh:   parseFloat(speed.toFixed(1)),
            battery_pct: battery,
            signal_bars: 3,
          }),
        });

        if (res.status === 401) {
          console.error("[simulator] The device key was rejected (revoked, or not for this server). Stopping.");
          await quit(1);
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (res.status === 404) {
            // Tag or animal not found — not a fatal error during mass simulation
          } else {
            console.error(`[${a.serialNumber}] ${res.status} ${text.slice(0, 100)}`);
          }
          return null;
        }

        const json = await res.json() as { fix_id: number; alerts_raised: number };
        if (json.alerts_raised > 0) {
          console.log(`  ⚠  Alert raised for ${a.serialNumber} (animal ${a.animalId})`);
        }
        return json;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("ECONNREFUSED")) {
          console.error("[simulator] Server not reachable at " + INGEST_URL);
          await quit(1);
        }
        console.error(`[${a.serialNumber}] fetch error: ${msg}`);
        return null;
      }
    });

    const sent    = results.filter(Boolean).length;
    console.log(`[tick ${tick}] ${sent}/${batch.length} fixes sent (${now})`);
  }

  // Run one tick immediately, then loop
  await doTick();
  const interval = setInterval(doTick, TICK_MS);

  process.on("SIGINT",  () => { clearInterval(interval); console.log("\n[simulator] stopped"); void quit(0); });
  process.on("SIGTERM", () => { clearInterval(interval); void quit(0); });
}

// Set once a temporary key exists, so a failure anywhere still revokes it.
let pendingCleanup: (() => Promise<void>) | null = null;

main().catch(async (err) => {
  console.error("Simulator error:", err.message ?? err);
  try { await pendingCleanup?.(); } catch { /* the next run revokes leftovers */ }
  process.exit(1);
});
