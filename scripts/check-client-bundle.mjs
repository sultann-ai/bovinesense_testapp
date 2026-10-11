// Fails if anything that reaches the browser could contain the Supabase service-role key.
// Run after `npm run build`:  npm run check:bundle
//
// Looks in .next/static (every file the browser can download) for
//   1. the variable NAME  SUPABASE_SERVICE_ROLE_KEY   (a client file that mentions it is a red flag),
//   2. the key's VALUE, when it is set in the environment or .env.local / .env,
//   3. any JWT whose payload says role = service_role (catches a key pasted into code).
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = ".next/static";
if (!existsSync(root)) {
  console.error("No .next/static folder: run `npm run build` first.");
  process.exit(2);
}

function envValue(name) {
  if (process.env[name]) return process.env[name];
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

const secret = envValue("SUPABASE_SERVICE_ROLE_KEY");
const jwt = /eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|mjs|css|html|json|map)$/.test(name)) yield p;
  }
}

let scanned = 0;
const problems = [];
for (const file of files(root)) {
  scanned++;
  const text = readFileSync(file, "utf8");
  if (text.includes("SUPABASE_SERVICE_ROLE_KEY")) problems.push(`${file}: mentions SUPABASE_SERVICE_ROLE_KEY`);
  if (secret.length >= 20 && text.includes(secret)) problems.push(`${file}: contains the service-role key value`);
  for (const m of text.matchAll(jwt)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
      if (payload.role === "service_role") problems.push(`${file}: contains a JWT with role=service_role`);
    } catch { /* not a JWT */ }
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} problem(s) in the client bundle:\n  ` + problems.join("\n  "));
  process.exit(1);
}
console.log(`OK: scanned ${scanned} client files in ${root}; no service-role key name, value or token found` +
  (secret ? "." : " (the key value is not set here, so only the name and JWT checks ran)."));
