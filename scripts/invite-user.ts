/**
 * Invite someone into an organization (there is no public sign-up).
 *
 *   npm run invite -- person@example.com --org <org-slug> --role org_admin
 *   npm run invite -- person@example.com --org <org-slug> --role regional_manager --region "<region name>"
 *   npm run invite -- person@example.com --org <org-slug> --role branch_officer --branch <branch code>
 *   npm run invite -- person@example.com --platform           (BovineSense staff, cross-tenant)
 *   add --name "Full Name" to set the display name
 *
 * Sends Supabase's invitation email; the link opens /reset-password where the person
 * chooses a password. If the address already has an account, no email is sent and the
 * membership is simply added. Uses the service-role key, so run it from a trusted machine.
 */
import { createScriptClient } from "./lib/supabase";
import { ROLES, isRole, type Role } from "../src/lib/auth/constants";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email || email.startsWith("--") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail("Usage: npm run invite -- <email> --org <slug> --role <role> [--region <name>] [--branch <code>] [--name <full name>]\n       npm run invite -- <email> --platform");
  }

  const platform = process.argv.includes("--platform");
  const orgSlug = arg("org");
  const roleArg = arg("role");
  const fullName = arg("name");

  if (!platform) {
    if (!orgSlug || !roleArg) fail("--org and --role are required (or use --platform).");
    if (!isRole(roleArg)) fail(`--role must be one of: ${ROLES.join(", ")}`);
  }

  const db = createScriptClient();

  // Resolve the membership first, so a typo fails before an email is sent.
  let membership: { organization_id: string; role: Role; region_id: number | null; branch_id: number | null } | null = null;
  if (!platform) {
    const role = roleArg as Role;
    const { data: org, error } = await db.from("organizations").select("id, name, status").eq("slug", orgSlug!).maybeSingle();
    if (error) throw error;
    if (!org) fail(`Organization '${orgSlug}' not found.`);
    if (org.status !== "active") fail(`Organization '${orgSlug}' is ${org.status}.`);

    let regionId: number | null = null;
    let branchId: number | null = null;
    if (role === "regional_manager") {
      const name = arg("region") ?? fail("--region <name> is required for regional_manager.");
      const { data } = await db.from("regions").select("id").eq("organization_id", org.id).eq("name", name).maybeSingle();
      if (!data) fail(`Region '${name}' not found in ${org.name}.`);
      regionId = data.id;
    }
    if (role === "branch_officer") {
      const code = arg("branch") ?? fail("--branch <code> is required for branch_officer.");
      const { data } = await db.from("branches").select("id").eq("organization_id", org.id).eq("code", code).maybeSingle();
      if (!data) fail(`Branch '${code}' not found in ${org.name}.`);
      branchId = data.id;
    }
    membership = { organization_id: org.id, role, region_id: regionId, branch_id: branchId };
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const invited = await db.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${site}/reset-password`,
    data: fullName ? { full_name: fullName } : undefined,
  });

  let userId: string;
  if (invited.error) {
    // Already registered: look the user up and just add the membership.
    let found: string | null = null;
    for (let page = 1; page <= 50 && !found; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      found = data.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
      if (data.users.length < 200) break;
    }
    if (!found) throw invited.error;
    userId = found;
    console.log(`${email} already has an account; no email sent.`);
  } else {
    userId = invited.data.user.id;
    console.log(`Invitation sent to ${email}.`);
  }

  if (fullName) await db.from("profiles").update({ full_name: fullName }).eq("id", userId);

  if (membership) {
    const { error } = await db.from("memberships").upsert(
      { user_id: userId, ...membership },
      { onConflict: "organization_id,user_id" },
    );
    if (error) throw error;
    console.log(`Membership: ${membership.role} in '${orgSlug}'.`);
  }
  if (platform) {
    const { error } = await db.from("platform_admins").upsert({ user_id: userId }, { onConflict: "user_id" });
    if (error) throw error;
    console.log("Added as platform admin.");
  }
}

main().catch((err) => {
  console.error("Failed:", err.message ?? err);
  process.exit(1);
});
