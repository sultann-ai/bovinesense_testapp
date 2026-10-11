/**
 * Reserves the one REAL tag for the demo: a non-simulated tag, with its own borrower, loan and animal
 * in Bank of Punjab's Lahore branch, on the Lahore district fence. The serial comes from the
 * environment so it never lives in code:
 *
 *   REAL_TAG_SERIAL=<serial printed on the tag> npm run seed:real-tag
 *
 * Run it after supabase/seed.sql. It is safe to repeat: an existing tag with that serial is reused.
 * The slot has no position until the tag sends its first fix, so it does not appear on the map until
 * then. Point the tag (or `curl`) at POST /api/ingest/fix with a Bank of Punjab device key.
 */
import { createScriptClient } from "./lib/supabase";

const ORG_SLUG = process.env.REAL_TAG_ORG ?? "bank-of-punjab";
const BRANCH_CODE = "LHE-001";

async function main() {
  const serial = process.env.REAL_TAG_SERIAL?.trim();
  if (!serial) {
    console.error("Set REAL_TAG_SERIAL to the serial number of the real tag (see .env.example).");
    process.exit(1);
  }
  const db = createScriptClient();

  const { data: org, error: orgError } = await db.from("organizations").select("id, name").eq("slug", ORG_SLUG).maybeSingle();
  if (orgError) throw orgError;
  if (!org) throw new Error(`Organization '${ORG_SLUG}' not found. Run supabase/seed.sql first.`);

  const { data: branch, error: branchError } = await db
    .from("branches").select("id, district").eq("organization_id", org.id).eq("code", BRANCH_CODE).maybeSingle();
  if (branchError) throw branchError;
  if (!branch) throw new Error(`Branch ${BRANCH_CODE} not found in ${org.name}. Run supabase/seed.sql first.`);

  const { data: existing, error: existingError } = await db
    .from("tags").select("id, organization_id").eq("serial_number", serial).maybeSingle();
  if (existingError) throw existingError;
  if (existing && existing.organization_id !== org.id) throw new Error(`Tag '${serial}' already belongs to another organization.`);

  let tagId = existing?.id;
  if (!tagId) {
    const { data, error } = await db.from("tags")
      .insert({ organization_id: org.id, serial_number: serial, is_simulated: false }).select("id").single();
    if (error) throw error;
    tagId = data.id;
  }

  const { data: already, error: alreadyError } = await db.from("animals").select("id").eq("tag_id", tagId).maybeSingle();
  if (alreadyError) throw alreadyError;
  if (already) {
    console.log(`Real tag ${serial} is already reserved (animal ${already.id}). Nothing to do.`);
    return;
  }

  const { data: borrower, error: bError } = await db.from("borrowers").insert({
    organization_id: org.id, name: "Live Demo Borrower", district: branch.district, branch_id: branch.id,
  }).select("id").single();
  if (bError) throw bError;

  const { data: loan, error: lError } = await db.from("loans").insert({
    organization_id: org.id, loan_number: "LN-LIVE-0001", borrower_id: borrower.id, branch_id: branch.id,
    amount_pkr: 500000, status: "active",
  }).select("id").single();
  if (lError) throw lError;

  const { data: animal, error: aError } = await db.from("animals").insert({
    organization_id: org.id, name: "Live demo animal", species: "cattle", tag_id: tagId,
    borrower_id: borrower.id, loan_id: loan.id, branch_id: branch.id, district: branch.district, status: "inside",
  }).select("id").single();
  if (aError) throw aError;

  const { data: fence, error: fError } = await db.from("geofences")
    .select("id").eq("organization_id", org.id).eq("type", "district").eq("district_name", branch.district ?? "").limit(1).maybeSingle();
  if (fError) throw fError;
  if (fence) {
    const { error } = await db.from("animal_geofence").insert({ organization_id: org.id, animal_id: animal.id, geofence_id: fence.id, is_active: true });
    if (error) throw error;
  }

  console.log(`Reserved real tag ${serial} for ${org.name}: animal ${animal.id}, loan LN-LIVE-0001${fence ? `, on the ${branch.district} district fence` : ""}.`);
  console.log("It appears on the map after its first fix. For the demo, draw a small polygon around the room and assign this animal to it (Geofences, then Assign animals).");
}

main().catch((err) => {
  console.error("Could not reserve the real tag:", err instanceof Error ? err.message : err);
  process.exit(1);
});
