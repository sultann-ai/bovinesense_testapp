-- BovineSense — onboard a new organization (lender) and make an existing user its admin.
--
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste -> edit the three values in the
-- "EDIT HERE" block -> Run. The SQL editor runs as the database owner, so it is allowed to write to
-- tables the app itself cannot (organizations, memberships). That is why this is a script you run by
-- hand and not something the app does: until there is a platform admin screen, this is the only way
-- to add a tenant, and only someone with access to the Supabase project can do it.
--
-- BEFORE YOU RUN IT
--   1. The person must already exist as a Supabase Auth user. Create them first with
--      Authentication -> Users -> Add user (or invite them), then use their e-mail below.
--   2. Pick a slug: lowercase letters, digits and single hyphens, unique across all organizations
--      (e.g. 'habib-bank'). Choose with care: it is the organization's short name in scripts.
--
-- WHAT IT DOES (all in one transaction: either everything happens or nothing does)
--   * creates the organization (status 'active', timezone Asia/Karachi, demo mode OFF, offline
--     threshold 6 h: the project defaults, all editable later in organizations.settings);
--   * adds the user to it as org_admin (an org_admin has no region or branch: the whole organization);
--   * makes sure the user has a profile row (the name shown in audit trails);
--   * writes one line to platform_audit_log so there is a record of who was onboarded.
--
-- WHAT IT DOES NOT DO
--   * it creates no regions, branches, borrowers or animals: the new admin (or you) adds those next;
--   * it never touches another organization. Running it twice with the same slug stops with an error
--     instead of changing anything.
--
-- AFTER IT RUNS
--   The result at the bottom shows the new organization. The user can sign in and will land in it.
--   To add more people later, use `npm run invite` (see README) or insert more rows into
--   public.memberships the same way as below.

begin;

do $onboard$
declare
  -- ===================== EDIT HERE =====================
  v_name       constant text := 'New Lender Name';          -- shown in the top bar
  v_slug       constant text := 'new-lender';               -- lowercase-with-hyphens, unique
  v_admin_mail constant text := 'admin@newlender.example';  -- an EXISTING Supabase Auth user
  -- =====================================================

  v_org_id  uuid;
  v_user_id uuid;
begin
  -- 1. The admin must already exist. Match case-insensitively.
  select u.id into v_user_id
    from auth.users u
   where lower(u.email) = lower(v_admin_mail);
  if v_user_id is null then
    raise exception 'No Supabase Auth user with e-mail %. Create the user first (Authentication -> Users).', v_admin_mail;
  end if;

  -- 2. The organization. A duplicate slug raises a unique-violation, which rolls everything back.
  insert into public.organizations (name, slug, settings)
  values (
    v_name,
    v_slug,
    jsonb_build_object(
      'timezone',    'Asia/Karachi',
      'demo_mode',   false,
      'alert_rules', jsonb_build_object('offline_threshold_hours', 6)
    )
  )
  returning id into v_org_id;

  -- 3. Make sure a profile exists (normally created automatically when the user is created).
  insert into public.profiles (id) values (v_user_id)
  on conflict (id) do nothing;

  -- 4. The membership. org_admin carries no region or branch (a table constraint enforces that).
  insert into public.memberships (user_id, organization_id, role)
  values (v_user_id, v_org_id, 'org_admin');

  -- 5. Leave a trace (project rule: cross-tenant actions are audit-logged).
  insert into public.platform_audit_log (user_id, organization_id, action, detail)
  values (null, v_org_id, 'organization_onboarded',
          jsonb_build_object('slug', v_slug, 'admin_email', v_admin_mail, 'via', 'supabase/scripts/onboard_org.sql'));

  raise notice 'Created organization % (%) with % as org_admin.', v_name, v_org_id, v_admin_mail;
end
$onboard$;

commit;

-- Check the result (edit the slug to match what you used above).
select o.id, o.name, o.slug, o.status, m.role, u.email as admin_email
  from public.organizations o
  join public.memberships m on m.organization_id = o.id
  join auth.users u on u.id = m.user_id
 where o.slug = 'new-lender';
