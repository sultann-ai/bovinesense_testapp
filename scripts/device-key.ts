/**
 * Manage an organization's device API keys from the command line.
 *
 *   npm run device-key -- create --org <org-slug> --label "North gateway"
 *   npm run device-key -- list   --org <org-slug>
 *   npm run device-key -- revoke --org <org-slug> <key id>
 *
 * `create` prints the key ONCE; only its SHA-256 hash is stored, so it cannot be shown again.
 * The same thing is available to organization admins in Settings → Device keys. This script uses
 * the service-role key, so run it from a trusted machine and keep the printed key out of logs.
 */
import { createScriptClient } from "./lib/supabase";
import { generateDeviceKey } from "../src/lib/device-keys";
import { DEVICE_KEY_LABEL_MAX } from "../src/lib/device-keys-shared";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const USAGE = `Usage:
  npm run device-key -- create --org <slug> --label <name>
  npm run device-key -- list   --org <slug>
  npm run device-key -- revoke --org <slug> <key id>`;

async function main() {
  const command = process.argv[2];
  if (!command || !["create", "list", "revoke"].includes(command)) fail(USAGE);

  const slug = arg("org") ?? fail(`--org <slug> is required.\n${USAGE}`);
  const db = createScriptClient();

  const { data: org, error: orgError } = await db
    .from("organizations")
    .select("id, name, status")
    .eq("slug", slug)
    .maybeSingle();
  if (orgError) throw orgError;
  if (!org) fail(`Organization '${slug}' not found.`);
  if (org.status !== "active") fail(`Organization '${slug}' is ${org.status}.`);

  if (command === "create") {
    const label = (arg("label") ?? "").trim();
    if (!label) fail(`--label <name> is required.\n${USAGE}`);
    if (label.length > DEVICE_KEY_LABEL_MAX) fail(`--label must be at most ${DEVICE_KEY_LABEL_MAX} characters.`);

    const { key, hash, prefix } = generateDeviceKey();
    const { data, error } = await db
      .from("device_api_keys")
      .insert({ organization_id: org.id, key_hash: hash, key_prefix: prefix, label })
      .select("id")
      .single();
    if (error) throw error;

    console.log(`Created key '${label}' for ${org.name} (id ${data.id}).`);
    console.log("Copy it now; it will not be shown again:\n");
    console.log(`  ${key}\n`);
    console.log("Send it as the x-api-key header to POST /api/ingest/fix.");
    return;
  }

  if (command === "list") {
    const { data, error } = await db
      .from("device_api_keys")
      .select("id, label, key_prefix, created_at, last_used_at, revoked_at")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (data.length === 0) {
      console.log(`${org.name} has no device keys.`);
      return;
    }
    for (const k of data) {
      console.log(
        `${k.id}  ${k.key_prefix}…  ${k.revoked_at ? "revoked" : "active "}  ` +
          `last used ${k.last_used_at ?? "never"}  ${k.label}`,
      );
    }
    return;
  }

  // revoke
  const id = process.argv.slice(3).find((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--org");
  if (!id) fail(`A key id is required.\n${USAGE}`);
  const { data, error } = await db
    .from("device_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", org.id)
    .eq("id", id)
    .is("revoked_at", null)
    .select("id, label");
  if (error) throw error;
  if (data.length === 0) fail(`No active key '${id}' in ${org.name}.`);
  console.log(`Revoked '${data[0].label}'. Devices using it now get 401.`);
}

main().catch((err) => {
  console.error("Failed:", err.message ?? err);
  process.exit(1);
});
