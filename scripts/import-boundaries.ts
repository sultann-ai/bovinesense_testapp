/**
 * Import Pakistan ADM2 district boundaries from data/pak_adm2.geojson into the
 * district_boundaries table through the import_district_boundary() database
 * function. Re-runnable: rows are matched on gadm_gid (the geoBoundaries shapeID).
 *
 * Run with: npm run import:boundaries
 */
import fs from "node:fs";
import path from "node:path";
import { createScriptClient } from "./lib/supabase";

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

  const db = createScriptClient();

  const raw = fs.readFileSync(GEOJSON_PATH, "utf8");
  const geojson = JSON.parse(raw) as GeoJSON.FeatureCollection;

  let imported = 0;
  let skipped  = 0;
  let failed   = 0;

  for (const feature of geojson.features as GeoJSON.Feature[]) {
    const props = feature.properties as Record<string, unknown> | null;
    const name  = props?.shapeName as string | undefined;
    if (!name || !feature.geometry) { skipped++; continue; }

    const { error } = await db.rpc("import_district_boundary", {
      p_name:     name,
      p_province: PUNJAB_DISTRICTS.has(name) ? "Punjab" : "Other",
      // shapeID is the stable key for re-runs; fall back to the name if a feature lacks one.
      p_gid:      (props?.shapeID as string | undefined) ?? name,
      p_geojson:  feature.geometry as never,
    });

    if (error) {
      failed++;
      console.error(`  ✗ ${name}: ${error.message}`);
      continue;
    }
    imported++;
  }

  console.log(`✓ Imported ${imported} districts, skipped ${skipped}, failed ${failed}`);
  const punjabCount = (geojson.features as GeoJSON.Feature[]).filter(
    f => PUNJAB_DISTRICTS.has((f.properties as Record<string,unknown>)?.shapeName as string)
  ).length;
  console.log(`  Punjab districts in file: ${punjabCount}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Import failed:", err.message ?? err);
  process.exit(1);
});
