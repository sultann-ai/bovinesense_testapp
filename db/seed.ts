/**
 * Seed 240 animals across 5 Punjab districts.
 * Each animal gets: borrower → loan → branch → region → district geofence.
 *
 * Run with: npx tsx db/seed.ts
 */
import "dotenv/config";
import { createDatabaseClient } from "./connection";

// ─── District centres and approximate bounding boxes ─────────────────────────
// Used to scatter farm coordinates realistically within each district.
const DISTRICTS: Array<{
  name: string;
  region: string;
  branch: string;
  branchCode: string;
  count: number;
  centre: [number, number]; // [lat, lon]
  spread: [number, number]; // [lat_delta, lon_delta]
}> = [
  { name: "Lahore",     region: "Central Punjab", branch: "Lahore Main",     branchCode: "LHE-001", count: 60, centre: [31.52, 74.36], spread: [0.20, 0.25] },
  { name: "Faisalabad", region: "Central Punjab", branch: "Faisalabad Main", branchCode: "FSD-001", count: 55, centre: [31.42, 73.08], spread: [0.28, 0.32] },
  { name: "Multan",     region: "South Punjab",   branch: "Multan Main",     branchCode: "MLT-001", count: 50, centre: [30.16, 71.52], spread: [0.24, 0.26] },
  { name: "Sahiwal",    region: "Central Punjab", branch: "Sahiwal Main",    branchCode: "SWL-001", count: 40, centre: [30.67, 73.11], spread: [0.18, 0.22] },
  { name: "Okara",      region: "Central Punjab", branch: "Okara Main",      branchCode: "OKR-001", count: 35, centre: [30.81, 73.45], spread: [0.16, 0.20] },
];

const FIRST_NAMES = ["Muhammad","Ali","Tariq","Khalid","Usman","Hassan","Bilal","Imran","Adnan","Sajid",
                     "Fatima","Sana","Razia","Nadia","Amna","Zainab","Rabia","Ayesha","Sadia","Noor"];
const LAST_NAMES  = ["Khan","Ahmad","Malik","Sheikh","Chaudhry","Butt","Hussain","Rana","Nawaz","Akbar",
                     "Qureshi","Ansari","Bhatti","Gillani","Hashmi","Mirza","Raja","Siddiqui","Memon","Lodhi"];

function rand(arr: string[]) { return arr[Math.floor(Math.random() * arr.length)]; }
function randFloat(min: number, max: number) { return min + Math.random() * (max - min); }
function randInt(min: number, max: number)   { return Math.floor(min + Math.random() * (max - min + 1)); }

function fakeCnic() {
  const prefix = ["34201","35201","36201","31201","33201"];
  return `${rand(prefix)}-${randInt(1000000, 9999999)}-${randInt(1,9)}`;
}

function fakePhone() { return `03${randInt(10,49)}${randInt(1000000,9999999)}`; }

function loanNumber(district: string, idx: number) {
  return `LN-2024-${district.slice(0,3).toUpperCase()}-${String(idx).padStart(4,"0")}`;
}

function tagSerial(idx: number, simulated = true) {
  return simulated ? `SIM-${String(idx).padStart(5,"0")}` : `TAG-${String(idx).padStart(5,"0")}`;
}

async function main() {
  const sql = createDatabaseClient({ direct: true, max: 1 });

  // ── 1. Truncate in dependency order ────────────────────────────────────────
  await sql`SET session_replication_role = replica`;
  for (const table of [
    "alerts","fixes","animal_geofence","geofences","animals","tags",
    "loans","borrowers","users","branches","regions","district_boundaries",
  ]) {
    await sql.unsafe(`TRUNCATE TABLE ${table} CASCADE`);
  }
  await sql`SET session_replication_role = DEFAULT`;
  console.log("✓ Tables cleared");

  // ── 2. Regions ──────────────────────────────────────────────────────────────
  const regionNames = [...new Set(DISTRICTS.map(d => d.region))];
  const regionMap: Record<string, number> = {};
  for (const name of regionNames) {
    const code = name.replace(/\s+/g, "_").toUpperCase();
    const [r] = await sql`
      INSERT INTO regions (name, code) VALUES (${name}, ${code})
      RETURNING id`;
    regionMap[name] = r.id;
  }
  console.log(`✓ ${regionNames.length} regions`);

  // ── 3. Branches ─────────────────────────────────────────────────────────────
  const branchMap: Record<string, number> = {};
  for (const d of DISTRICTS) {
    const [b] = await sql`
      INSERT INTO branches (name, code, region_id, district)
      VALUES (${d.branch}, ${d.branchCode}, ${regionMap[d.region]}, ${d.name})
      RETURNING id`;
    branchMap[d.name] = b.id;
  }
  console.log(`✓ ${DISTRICTS.length} branches`);

  // ── 4. District geofences (one per district, type = district) ───────────────
  // We copy the geometry from district_boundaries for the 5 seeded districts.
  const fenceMap: Record<string, number> = {};
  for (const d of DISTRICTS) {
    const [row] = await sql`
      SELECT id FROM district_boundaries WHERE district_name = ${d.name} LIMIT 1`;
    if (!row) {
      console.warn(`  ⚠ District boundary not found for ${d.name} — using approximate bbox`);
      // Fallback: insert a rough bbox polygon as the geofence
      const [lat, lon] = d.centre;
      const [dlat, dlon] = d.spread;
      const wkt = `POLYGON((${lon-dlon} ${lat-dlat}, ${lon+dlon} ${lat-dlat}, ${lon+dlon} ${lat+dlat}, ${lon-dlon} ${lat+dlat}, ${lon-dlon} ${lat-dlat}))`;
      const [f] = await sql`
        INSERT INTO geofences (name, type, geom, warning_buffer_m, district_name)
        VALUES (
          ${d.name + " District"},
          'district',
          ST_GeomFromText(${wkt}, 4326),
          500,
          ${d.name}
        ) RETURNING id`;
      fenceMap[d.name] = f.id;
    } else {
      const [f] = await sql`
        INSERT INTO geofences (name, type, geom, warning_buffer_m, district_name)
        SELECT
          ${d.name + " District"},
          'district',
          geom,
          500,
          ${d.name}
        FROM district_boundaries WHERE id = ${row.id}
        RETURNING id`;
      fenceMap[d.name] = f.id;
    }
  }
  console.log(`✓ ${DISTRICTS.length} district geofences`);

  // ── 5. Animals, borrowers, loans, tags ─────────────────────────────────────
  let animalCount = 0;
  let globalIdx   = 1;

  for (const district of DISTRICTS) {
    for (let i = 0; i < district.count; i++, globalIdx++) {
      // Borrower
      const bName = `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`;
      const [borrower] = await sql`
        INSERT INTO borrowers (name, cnic, phone, district, branch_id)
        VALUES (${bName}, ${fakeCnic()}, ${fakePhone()}, ${district.name}, ${branchMap[district.name]})
        RETURNING id`;

      // Loan
      const [loan] = await sql`
        INSERT INTO loans (loan_number, borrower_id, branch_id, amount_pkr, disbursed_at, status)
        VALUES (
          ${loanNumber(district.name, globalIdx)},
          ${borrower.id},
          ${branchMap[district.name]},
          ${randInt(200000, 1500000)},
          NOW() - INTERVAL '1 year' * ${Math.random()},
          'active'
        ) RETURNING id`;

      // Tag (simulated)
      const [tag] = await sql`
        INSERT INTO tags (serial_number, is_simulated, last_seen_at)
        VALUES (${tagSerial(globalIdx)}, true, NOW() - INTERVAL '10 minutes' * ${Math.random() * 6})
        RETURNING id`;

      // Animal — initial position scattered around district centre
      const [lat, lon] = district.centre;
      const [dlat, dlon] = district.spread;
      const animalLat = randFloat(lat - dlat * 0.7, lat + dlat * 0.7);
      const animalLon = randFloat(lon - dlon * 0.7, lon + dlon * 0.7);
      const sex    = Math.random() > 0.4 ? "female" : "male";
      const age    = randFloat(1.5, 8.0);

      const [animal] = await sql`
        INSERT INTO animals (name, species, sex, age_years, tag_id, borrower_id, loan_id, branch_id, district, status)
        VALUES (
          ${`Animal-${String(globalIdx).padStart(3,"0")}`},
          'cattle', ${sex}, ${age},
          ${tag.id}, ${borrower.id}, ${loan.id}, ${branchMap[district.name]},
          ${district.name}, 'inside'
        ) RETURNING id`;

      // Initial fix
      const pointWkt = `POINT(${animalLon} ${animalLat})`;
      await sql`
        INSERT INTO fixes (tag_id, animal_id, geom, lat, lon, fixed_at, battery_pct, signal_bars, is_simulated)
        VALUES (
          ${tag.id}, ${animal.id},
          ST_GeomFromText(${pointWkt}, 4326),
          ${animalLat}, ${animalLon},
          NOW() - INTERVAL '10 minutes' * ${Math.random() * 3},
          ${randInt(30, 95)}, ${randInt(2, 4)},
          true
        )`;

      // Animal–geofence assignment
      await sql`
        INSERT INTO animal_geofence (animal_id, geofence_id, is_active)
        VALUES (${animal.id}, ${fenceMap[district.name]}, true)`;

      animalCount++;
    }
    console.log(`  ✓ ${district.name}: ${district.count} animals`);
  }

  console.log(`\n✓ Seed complete — ${animalCount} animals, ${globalIdx - 1} tags`);

  // ── 6. One HQ admin user ────────────────────────────────────────────────────
  const [hqBranch] = await sql`SELECT id FROM branches LIMIT 1`;
  await sql`
    INSERT INTO users (name, email, role, branch_id)
    VALUES ('HQ Admin', 'admin@bovinetrack.pk', 'hq_admin', ${hqBranch.id})
    ON CONFLICT (email) DO NOTHING`;
  console.log("✓ HQ admin user created");

  await sql.end();
}

main().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
