# Test accounts (development only)

> **Never create these in a project that holds real data or is reachable by untrusted people.**
> Every account shares one published password. `npm run seed:accounts` refuses to run when
> `NODE_ENV=production`, but that is a seat belt, not a control: delete the accounts
> (`npm run seed:accounts:remove`) before anything real goes into the project.

## Create or reset them

After the migrations are applied and `supabase/seed.sql` has run (so both organizations exist):

```powershell
npm run seed:accounts
```

Re-running resets each password to the one below and repairs the memberships. To delete them:

```powershell
npm run seed:accounts:remove
```

## Password

All accounts: **`BovineSense-Dev-2026`**

## Accounts

One user per role in each seeded organization, plus two cross-organization users.

### Bank of Punjab (`bank-of-punjab`)

| Role | Email | Scope | Can do |
|---|---|---|---|
| Organization admin | `org-admin.bop@bovinesense.test` | whole organization | everything, including geofences |
| Regional manager | `regional-manager.bop@bovinesense.test` | region *Central Punjab* only | see that region; acknowledge / assign / resolve its alerts |
| Branch officer | `branch-officer.bop@bovinesense.test` | branch *Lahore Main* (LHE-001) only | see that branch; acknowledge / assign / resolve its alerts |
| Auditor | `auditor.bop@bovinesense.test` | whole organization | read-only; every change is refused |

### Demo Bank (`demo-bank`)

| Role | Email | Scope | Can do |
|---|---|---|---|
| Organization admin | `org-admin.demo@bovinesense.test` | whole organization | everything, including geofences |
| Regional manager | `regional-manager.demo@bovinesense.test` | region *Central Punjab* only | see that region; acknowledge / assign / resolve its alerts |
| Branch officer | `branch-officer.demo@bovinesense.test` | branch *Lahore Main* (LHE-001) only | see that branch; acknowledge / assign / resolve its alerts |
| Auditor | `auditor.demo@bovinesense.test` | whole organization | read-only; every change is refused |

### Cross-organization

| Account | Email | What it exercises |
|---|---|---|
| Platform admin | `platform-admin@bovinesense.test` | Organization picker listing **every** organization. **Read-only** in whichever one is chosen (database policies grant it reads across organizations and no writes). Opening an organization it is not a member of is written to `platform_audit_log`. |
| Auditor in both | `auditor.both@bovinesense.test` | Organization picker for an ordinary user with two memberships (read-only in each). |

## What to try

1. **Single organization:** sign in as `org-admin.bop@…`. You go straight to Bank of Punjab, no picker.
2. **Picker:** sign in as `auditor.both@…` or `platform-admin@…`; choose an organization. Use *Switch organization* in the account menu to change.
3. **Isolation:** sign in as `org-admin.demo@…`. You see Demo Bank's 14 animals and none of Bank of Punjab's 240, and `GET /api/animals/<a Bank of Punjab animal id>` answers 404.
4. **Scoping:** the Lahore branch officer sees only Lahore Main animals and alerts; the regional manager sees only Central Punjab.
5. **Read-only:** the auditor and the platform admin can browse but not change anything. Alert actions, bulk selection and *New geofence* are hidden or disabled, and acknowledging an alert returns 403 (and would be refused by the database anyway).
5b. **Roles:** only the org admin sees *Settings* and can create or delete geofences; branch officers and regional managers can acknowledge, assign and resolve alerts inside their scope.
6. **Forgot password:** use *Forgot password?* on the sign-in page. Test accounts use the `.test` domain, so no email is delivered; request the link for a real address instead, or read the link from **Authentication → Logs**.

## Real users

Do not use this mechanism for real people. Invite them (no password is ever shared):

```powershell
npm run invite -- person@example.com --org bank-of-punjab --role org_admin
```

See "Authentication" in the README.
