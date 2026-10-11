/**
 * DEV ONLY. Creates one test user per role in each seeded organization, plus a platform
 * admin and a user who belongs to both organizations (to exercise the organization
 * picker). Credentials are listed in docs/TEST_ACCOUNTS.md.
 *
 * Every account shares one well-known password, so NEVER run this against a project
 * that holds real data or that anyone untrusted can reach. It refuses to run when
 * NODE_ENV=production. Remove the accounts again with `npm run seed:accounts:remove`.
 *
 *   npm run seed:accounts           create / reset the accounts
 *   npm run seed:accounts:remove    delete them
 *
 * Needs the migrations and supabase/seed.sql applied first (organizations, a region
 * called "Central Punjab" and the branch LHE-001 must exist in both organizations).
 */
import { createScriptClient } from "./lib/supabase";
import { ROLES, type Role } from "../src/lib/auth/constants";

// Satisfies the project's password policy (10+ characters, upper, lower, digit).
export const TEST_PASSWORD = "BovineSense-Dev-2026";
const EMAIL_DOMAIN = "bovinesense.test";

const ORGS = [
  { slug: "bank-of-punjab", short: "bop",  name: "Bank of Punjab" },
  { slug: "demo-bank",      short: "demo", name: "Demo Bank" },
] as const;

const REGION_NAME = "Central Punjab";
const BRANCH_CODE = "LHE-001";

interface Account {
  email: string;
  fullName: string;
  /** Organization memberships to create. */
  memberships: Array<{ slug: string; role: Role }>;
  platformAdmin?: boolean;
}

function buildAccounts(): Account[] {
  const accounts: Account[] = [];
  for (const org of ORGS) {
    for (const role of ROLES) {
      accounts.push({
        email: `${role.replace(/_/g, "-")}.${org.short}@${EMAIL_DOMAIN}`,
        fullName: `${titleCase(role)} (${org.name})`,
        memberships: [{ slug: org.slug, role }],
      });
    }
  }
  accounts.push({
    email: `platform-admin@${EMAIL_DOMAIN}`,
    fullName: "Platform Admin (BovineSense)",
    memberships: [],
    platformAdmin: true,
  });
  accounts.push({
    email: `auditor.both@${EMAIL_DOMAIN}`,
    fullName: "Auditor (both organizations)",
    memberships: ORGS.map((o) => ({ slug: o.slug, role: "auditor" as Role })),
  });
  return accounts;
}

function titleCase(role: string) {
  return role.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to create shared-password test accounts with NODE_ENV=production.");
    process.exit(1);
  }

  const remove = process.argv.includes("--remove");
  const db = createScriptClient();
  const accounts = buildAccounts();

  // Find a user by email (Auth has no lookup-by-email in the admin API).
  async function findUserId(email: string): Promise<string | null> {
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (hit) return hit.id;
      if (data.users.length < 200) return null;
    }
    return null;
  }

  if (remove) {
    for (const a of accounts) {
      const id = await findUserId(a.email);
      if (!id) { console.log(`  - ${a.email}: not found`); continue; }
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) throw error;
      console.log(`  ✓ deleted ${a.email}`);
    }
    return;
  }

  // Organizations, plus the region / branch used to scope two of the roles.
  const orgs = new Map<string, { id: string; regionId: number; branchId: number }>();
  for (const org of ORGS) {
    const { data: o, error } = await db.from("organizations").select("id").eq("slug", org.slug).maybeSingle();
    if (error) throw error;
    if (!o) throw new Error(`Organization '${org.slug}' not found. Run supabase/seed.sql first.`);

    const { data: region } = await db.from("regions").select("id")
      .eq("organization_id", o.id).eq("name", REGION_NAME).maybeSingle();
    const { data: branch } = await db.from("branches").select("id")
      .eq("organization_id", o.id).eq("code", BRANCH_CODE).maybeSingle();
    if (!region || !branch) {
      throw new Error(`'${org.slug}' needs region '${REGION_NAME}' and branch '${BRANCH_CODE}' (from supabase/seed.sql).`);
    }
    orgs.set(org.slug, { id: o.id, regionId: region.id, branchId: branch.id });
  }

  for (const a of accounts) {
    // Create the user, or reset the password of the existing one.
    let userId: string;
    const created = await db.auth.admin.createUser({
      email: a.email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: a.fullName },
    });
    if (created.error) {
      const existing = await findUserId(a.email);
      if (!existing) throw created.error;
      const { error } = await db.auth.admin.updateUserById(existing, {
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: a.fullName },
      });
      if (error) throw error;
      userId = existing;
    } else {
      userId = created.data.user.id;
    }

    // The profile row comes from the auth.users trigger; make sure the name is set.
    await db.from("profiles").update({ full_name: a.fullName }).eq("id", userId);

    for (const m of a.memberships) {
      const org = orgs.get(m.slug)!;
      const { error } = await db.from("memberships").upsert(
        {
          user_id: userId,
          organization_id: org.id,
          role: m.role,
          region_id: m.role === "regional_manager" ? org.regionId : null,
          branch_id: m.role === "branch_officer" ? org.branchId : null,
        },
        { onConflict: "organization_id,user_id" },
      );
      if (error) throw error;
    }

    if (a.platformAdmin) {
      const { error } = await db.from("platform_admins").upsert({ user_id: userId }, { onConflict: "user_id" });
      if (error) throw error;
    }

    console.log(`  ✓ ${a.email}`);
  }

  console.log(`\n${accounts.length} accounts ready. Password for all of them: ${TEST_PASSWORD}`);
  console.log("See docs/TEST_ACCOUNTS.md. Development only.");
}

main().catch((err) => {
  console.error("Failed:", err.message ?? err);
  process.exit(1);
});
