/**
 * Bovine Track simulator
 *
 * Usage:
 *   npm run simulate              — run all animals in normal drift mode
 *   npm run simulate breach       — trigger a breach scenario
 *   npm run simulate fast         — trigger a fast-movement scenario
 *   npm run simulate offline      — trigger an offline scenario (stop one tag)
 *
 * Animals drift slowly inside their districts (a few hundred metres per tick).
 * Each tick sends a fix to POST /api/ingest/fix using the INGEST_API_KEY.
 * Simulated tags are marked is_simulated = true.
 */
import "dotenv/config";
import postgres from "postgres";
import { createDatabaseClient } from "../db/connection";

// ─── Config ──────────────────────────────────────────────────────────────────
const INGEST_URL  = process.env.INGEST_URL ?? "http://localhost:3000/api/ingest/fix";
const API_KEY     = process.env.INGEST_API_KEY ?? "";
const TICK_MS     = 8_000;           // 8 s between rounds
const DRIFT_KM    = 0.05;            // normal drift per tick (50 m)
const BREACH_KM   = 0.3;             // breach scenario step per tick
const FAST_SPEED  = 40;              // km/h for fast scenario
const NORMAL_SPEED = 0.8;            // km/h for normal drift
const SCENARIO     = (process.argv[2] ?? "").toLowerCase();

// ─── Scenario animal indices ──────────────────────────────────────────────────
// These are resolved from the DB at startup.
let breachAnimalIdx  = 0;   // index into loaded animals array
let fastAnimalIdx    = 1;
let offlineAnimalIdx = 2;

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
async function main() {
  if (!API_KEY) { console.error("INGEST_API_KEY is not set"); process.exit(1); }

  const sql = createDatabaseClient({ direct: true, max: 2 });

  // Load all simulated animals with their last fix position
  const rows = await sql`
    SELECT
      a.id   AS animal_id,
      t.id   AS tag_id,
      t.serial_number,
      a.district,
      f.lat,
      f.lon
    FROM   animals a
    JOIN   tags    t ON t.id = a.tag_id AND t.is_simulated
    LEFT JOIN LATERAL (
      SELECT lat, lon FROM fixes
      WHERE animal_id = a.id
      ORDER BY fixed_at DESC LIMIT 1
    ) f ON true
    ORDER BY a.id
  `;

  if (rows.length === 0) {
    console.error("No simulated animals found. Run: npx tsx db/seed.ts first.");
    await sql.end();
    process.exit(1);
  }

  // Build state
  const animals: AnimalState[] = rows.map((r) => {
    const meta = DISTRICT_META[r.district] ?? { lat: 31.0, lon: 73.0, dlat: 0.2, dlon: 0.2 };
    return {
      animalId:     r.animal_id,
      tagId:        r.tag_id,
      serialNumber: r.serial_number,
      lat:          r.lat  ?? meta.lat,
      lon:          r.lon  ?? meta.lon,
      district:     r.district,
      centreLat:    meta.lat,
      centreLon:    meta.lon,
      spreadLat:    meta.dlat,
      spreadLon:    meta.dlon,
    };
  });

  // Ensure scenario indices are in bounds
  breachAnimalIdx  = Math.min(breachAnimalIdx,  animals.length - 1);
  fastAnimalIdx    = Math.min(fastAnimalIdx,    animals.length - 1);
  offlineAnimalIdx = Math.min(offlineAnimalIdx, animals.length - 1);

  console.log(`[simulator] Loaded ${animals.length} simulated animals`);
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

  await sql.end();

  let tick = 0;

  async function doTick() {
    tick++;
    const now    = new Date().toISOString();
    const batch  = SCENARIO === "offline"
      ? animals.filter((_, i) => i !== offlineAnimalIdx)
      : animals;

    const promises = batch.map(async (a, idx) => {
      let lat     = a.lat;
      let lon     = a.lon;
      let speed   = NORMAL_SPEED + Math.random() * 0.5;
      let battery = 60 + Math.floor(Math.random() * 30);

      if (SCENARIO === "breach" && idx === breachAnimalIdx) {
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
          process.exit(1);
        }
        console.error(`[${a.serialNumber}] fetch error: ${msg}`);
        return null;
      }
    });

    const results = await Promise.all(promises);
    const sent    = results.filter(Boolean).length;
    console.log(`[tick ${tick}] ${sent}/${batch.length} fixes sent (${now})`);
  }

  // Run one tick immediately, then loop
  await doTick();
  const interval = setInterval(doTick, TICK_MS);

  process.on("SIGINT",  () => { clearInterval(interval); console.log("\n[simulator] stopped"); process.exit(0); });
  process.on("SIGTERM", () => { clearInterval(interval); process.exit(0); });
}

main().catch((err) => {
  console.error("Simulator error:", err.message ?? err);
  process.exit(1);
});
