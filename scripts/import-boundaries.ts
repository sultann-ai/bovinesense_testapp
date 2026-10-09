/**
 * Import Pakistan ADM2 district boundaries from data/pak_adm2.geojson
 * into the district_boundaries table using ST_GeomFromGeoJSON.
 *
 * Run with: npx tsx scripts/import-boundaries.ts
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createDatabaseClient } from "../db/connection";

const GEOJSON_PATH = path.join(process.cwd(), "data", "pak_adm2.geojson");

// Province names that contain Punjab districts — geoBoundaries ADM2 only has
// ADM2 names; we infer province from known district lists.
const PUNJAB_DISTRICTS = new Set([
  "Attock", "Bahawalnagar", "Bahawalpur", "Chakwal", "Chiniot",
  "Dera Ghazi Khan", "Faisalabad", "Gujranwala", "Gujrat", "Hafizabad",
  "Jhang", "Jhelum", "Kasur", "Khanewal", "Khushab", "Lahore",
  "Layyah", "Lodhran", "Mandi Bahauddin", "Mianwali", "Multan",
  "Muzaffargarh", "Nankana Sahib", "Narowal", "Okara", "Pakpattan",
  "Rahim Yar Khan", "Rawalpindi", "Sahiwal", "Sargodha", "Sheikhupura",
  "Sialkot", "Toba Tek Singh", "Vehari",
]);

async function main() {
  if (!fs.existsSync(GEOJSON_PATH)) {
    console.error(`\n⛔ GeoJSON not found at ${GEOJSON_PATH}`);
    console.error("   Please fetch it manually:");
    console.error("   URL: https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/PAK/ADM2/geoBoundaries-PAK-ADM2.geojson");
    console.error("   Save as: data/pak_adm2.geojson");
    process.exit(1);
  }

  const sql = createDatabaseClient({ direct: true, max: 1 });

  const raw = fs.readFileSync(GEOJSON_PATH, "utf8");
  const geojson = JSON.parse(raw) as GeoJSON.FeatureCollection;

  let inserted = 0;
  let skipped  = 0;

  for (const feature of geojson.features as GeoJSON.Feature[]) {
    const props = feature.properties as Record<string, unknown> | null;
    const name  = props?.shapeName as string | undefined;
    if (!name || !feature.geometry) { skipped++; continue; }

    const province = PUNJAB_DISTRICTS.has(name) ? "Punjab" : "Other";
    const geomJson = JSON.stringify(feature.geometry);
    const shapeId  = props?.shapeID as string | undefined;

    await sql`
      INSERT INTO district_boundaries (district_name, province, gadm_gid, geom)
      VALUES (
        ${name},
        ${province},
        ${shapeId ?? null},
        ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326)
      )
      ON CONFLICT DO NOTHING
    `;
    inserted++;
  }

  console.log(`✓ Imported ${inserted} districts, skipped ${skipped}`);
  const punjabCount = (geojson.features as GeoJSON.Feature[]).filter(
    f => PUNJAB_DISTRICTS.has((f.properties as Record<string,unknown>)?.shapeName as string)
  ).length;
  console.log(`  Punjab districts imported: ${punjabCount}`);
  await sql.end();
}

main().catch((err) => {
  console.error("Import failed:", err.message ?? err);
  process.exit(1);
});
