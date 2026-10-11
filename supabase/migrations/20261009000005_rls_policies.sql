-- BovineSense — Row Level Security: tenant isolation and roles enforced by the database.
--
-- Until now the API used the service-role key (which bypasses RLS) and enforced tenancy in
-- application code. With this migration an `authenticated` user can only ever reach rows the
-- policies below allow, whatever code is calling. The app now queries as the signed-in user;
-- the service role remains only for system paths with no user (tag ingestion, scripts).
--
-- The model
--   * organization isolation   a user sees only organizations they are a member of
--                              (and only while the organization is active)
--   * org_admin / auditor      whole organization (auditor read-only)
--   * regional_manager         only branches of their region
--   * branch_officer           only their branch
--   * who may write            alerts: org_admin, regional_manager, branch_officer (inside their
--                              scope); everything else (users, geofences, regions, branches,
--                              borrowers, loans, tags, animals, settings): org_admin only
--   * platform_admin           READ across organizations through an explicit clause
--                              (is_platform_admin()), never by bypassing RLS. Read-only: to
--                              change data in an organization a platform admin needs a
--                              membership there, which is an explicit, auditable act.
--
-- Helper functions are SECURITY DEFINER with an empty search_path so policies can consult
-- `memberships` without recursing into its own policies. They only ever answer about the
-- calling user (auth.uid()).
--
-- IMPORTANT for later migrations: do not blanket `revoke ... from authenticated` again;
-- the grants at the bottom of this file are the allow-list.

-- ─── Helper functions ────────────────────────────────────────────────────────

create function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins p where p.user_id = (select auth.uid())
  );
$$;

-- Organizations the caller is a member of (active ones only).
create function public.current_org_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.organization_id
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
    and o.status = 'active';
$$;

-- Does the caller hold one of these roles in this organization?
create function public.has_any_role(p_org uuid, p_roles public.org_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.user_id = (select auth.uid())
      and m.organization_id = p_org
      and o.status = 'active'
      and m.role = any (p_roles)
  );
$$;

create function public.has_role(p_org uuid, p_role public.org_role)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_any_role(p_org, array[p_role]);
$$;

-- org_admin and auditor are not restricted to a region or branch.
create function public.can_see_whole_org(p_org uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_any_role(p_org, array['org_admin', 'auditor']::public.org_role[]);
$$;

-- Branch ids the caller may see, across all their organizations:
--   org_admin / auditor -> every branch of the organization
--   regional_manager    -> branches of their region
--   branch_officer      -> their own branch
create function public.user_branch_scope()
returns setof integer
language sql stable security definer set search_path = ''
as $$
  select b.id
  from public.branches b
  join public.memberships m
    on m.organization_id = b.organization_id
   and m.user_id = (select auth.uid())
  join public.organizations o
    on o.id = m.organization_id
   and o.status = 'active'
  where m.role in ('org_admin', 'auditor')
     or (m.role = 'regional_manager' and b.region_id = m.region_id)
     or (m.role = 'branch_officer'   and b.id = m.branch_id);
$$;

-- People who share at least one organization with the caller (so names can be shown).
create function public.org_member_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select distinct m2.user_id
  from public.memberships m1
  join public.memberships m2 on m2.organization_id = m1.organization_id
  where m1.user_id = (select auth.uid());
$$;

-- ─── Policies ────────────────────────────────────────────────────────────────
-- (RLS is already enabled on every table by the earlier migrations.)

-- organizations -------------------------------------------------------------
create policy organizations_select on public.organizations
  for select to authenticated
  using (id in (select public.current_org_ids()) or public.is_platform_admin());

-- Name, branding and settings: org_admin only. Column grants below keep slug and status out of
-- reach of the organization itself (suspension is a platform decision).
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.has_role(id, 'org_admin'))
  with check (public.has_role(id, 'org_admin'));

-- profiles ------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select public.org_member_ids())
    or public.is_platform_admin()
  );

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- memberships (user management: org_admin only) --------------------------------
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_role(organization_id, 'org_admin')
    or public.is_platform_admin()
  );

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (public.has_role(organization_id, 'org_admin'));

create policy memberships_update on public.memberships
  for update to authenticated
  using (public.has_role(organization_id, 'org_admin'))
  with check (public.has_role(organization_id, 'org_admin'));

create policy memberships_delete on public.memberships
  for delete to authenticated
  using (public.has_role(organization_id, 'org_admin'));

-- regions / branches ----------------------------------------------------------
create policy regions_select on public.regions
  for select to authenticated
  using (
    public.can_see_whole_org(organization_id)
    or id in (select b.region_id from public.branches b)   -- branches are already scoped
    or public.is_platform_admin()
  );
create policy regions_insert on public.regions
  for insert to authenticated with check (public.has_role(organization_id, 'org_admin'));
create policy regions_update on public.regions
  for update to authenticated
  using (public.has_role(organization_id, 'org_admin'))
  with check (public.has_role(organization_id, 'org_admin'));
create policy regions_delete on public.regions
  for delete to authenticated using (public.has_role(organization_id, 'org_admin'));

create policy branches_select on public.branches
  for select to authenticated
  using (id in (select public.user_branch_scope()) or public.is_platform_admin());
create policy branches_insert on public.branches
  for insert to authenticated with check (public.has_role(organization_id, 'org_admin'));
create policy branches_update on public.branches
  for update to authenticated
  using (public.has_role(organization_id, 'org_admin'))
  with check (public.has_role(organization_id, 'org_admin'));
create policy branches_delete on public.branches
  for delete to authenticated using (public.has_role(organization_id, 'org_admin'));

-- borrowers / loans (branch-scoped) ---------------------------------------------
create policy borrowers_select on public.borrowers
  for select to authenticated
  using (branch_id in (select public.user_branch_scope()) or public.is_platform_admin());
create policy borrowers_insert on public.borrowers
  for insert to authenticated with check (public.has_role(organization_id, 'org_admin'));
create policy borrowers_update on public.borrowers
  for update to authenticated
  using (public.has_role(organization_id, 'org_admin'))
  with check (public.has_role(organization_id, 'org_admin'));
create policy borrowers_delete on public.borrowers
  for delete to authenticated using (public.has_role(organization_id, 'org_admin'));

create policy loans_select on public.loans
  for select to authenticated
  using (branch_id in (select public.user_branch_scope()) or public.is_platform_admin());
create policy loans_insert on public.loans
  for insert to authenticated with check (public.has_role(organization_id, 'org_admin'));
create policy loans_update on public.loans
  for update to authenticated
  using (public.has_role(organization_id, 'org_admin'))
  with check (public.has_role(organization_id, 'org_admin'));
create policy loans_delete on public.loans
  for delete to authenticated using (public.has_role(organization_id, 'org_admin'));

-- animals (branch-scoped) and what hangs off them ------------------------------------
create policy animals_select on public.animals
  for select to authenticated
  using (branch_id in (select public.user_branch_scope()) or public.is_platform_admin());
create policy animals_insert on public.animals
  for insert to authenticated with check (public.has_role(organization_id, 'org_admin'));
create policy animals_update on public.animals
  for update to authenticated
  using (public.has_role(organization_id, 'org_admin'))
  with check (public.has_role(organization_id, 'org_admin'));
create policy animals_delete on public.animals
  for delete to authenticated using (public.has_role(organization_id, 'org_admin'));

-- A tag is visible to whole-organization readers, or when it belongs to an animal the
-- caller can see (so a branch officer sees their tags, not other branches' inventory).
create policy tags_select on public.tags
  for select to authenticated
  using (
    public.can_see_whole_org(organization_id)
    or id in (select a.tag_id from public.animals a)
    or public.is_platform_admin()
  );
create policy tags_insert on public.tags
  for insert to authenticated with check (public.has_role(organization_id, 'org_admin'));
create policy tags_update on public.tags
  for update to authenticated
  using (public.has_role(organization_id, 'org_admin'))
  with check (public.has_role(organization_id, 'org_admin'));
create policy tags_delete on public.tags
  for delete to authenticated using (public.has_role(organization_id, 'org_admin'));

-- Fence assignment follows the animal; managing it is a geofence-management act (org_admin).
create policy animal_geofence_select on public.animal_geofence
  for select to authenticated
  using (animal_id in (select a.id from public.animals a));
create policy animal_geofence_insert on public.animal_geofence
  for insert to authenticated with check (public.has_role(organization_id, 'org_admin'));
create policy animal_geofence_update on public.animal_geofence
  for update to authenticated
  using (public.has_role(organization_id, 'org_admin'))
  with check (public.has_role(organization_id, 'org_admin'));
create policy animal_geofence_delete on public.animal_geofence
  for delete to authenticated using (public.has_role(organization_id, 'org_admin'));

-- geofences: organization-level configuration -----------------------------------------
create policy geofences_select on public.geofences
  for select to authenticated
  using (organization_id in (select public.current_org_ids()) or public.is_platform_admin());
create policy geofences_insert on public.geofences
  for insert to authenticated with check (public.has_role(organization_id, 'org_admin'));
create policy geofences_update on public.geofences
  for update to authenticated
  using (public.has_role(organization_id, 'org_admin'))
  with check (public.has_role(organization_id, 'org_admin'));
create policy geofences_delete on public.geofences
  for delete to authenticated using (public.has_role(organization_id, 'org_admin'));

-- fixes: read-only for users (written by ingestion with the service role) -----------------
create policy fixes_select on public.fixes
  for select to authenticated
  using (
    animal_id in (select a.id from public.animals a)
    or (animal_id is null and public.can_see_whole_org(organization_id))
    or (animal_id is null and public.is_platform_admin())
  );

-- alerts: readable inside scope; workflow changes by the three working roles -----------------
create policy alerts_select on public.alerts
  for select to authenticated
  using (animal_id in (select a.id from public.animals a));

create policy alerts_update on public.alerts
  for update to authenticated
  using (
    animal_id in (select a.id from public.animals a)
    and public.has_any_role(
          organization_id,
          array['org_admin', 'regional_manager', 'branch_officer']::public.org_role[])
  )
  with check (
    animal_id in (select a.id from public.animals a)
    and public.has_any_role(
          organization_id,
          array['org_admin', 'regional_manager', 'branch_officer']::public.org_role[])
  );

-- alert_events: an append-only audit trail. The actor must be the caller; no update/delete.
create policy alert_events_select on public.alert_events
  for select to authenticated
  using (alert_id in (select al.id from public.alerts al));

create policy alert_events_insert on public.alert_events
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and alert_id in (select al.id from public.alerts al)
    and public.has_any_role(
          organization_id,
          array['org_admin', 'regional_manager', 'branch_officer']::public.org_role[])
  );

-- shared reference data and platform tables --------------------------------------------------
create policy district_boundaries_select on public.district_boundaries
  for select to authenticated using (true);

create policy platform_admins_select on public.platform_admins
  for select to authenticated using (user_id = (select auth.uid()));

create policy platform_audit_log_select on public.platform_audit_log
  for select to authenticated using (public.is_platform_admin());

create policy platform_audit_log_insert on public.platform_audit_log
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_platform_admin());

-- ─── Privileges (allow-list). RLS decides rows; these decide which statements are possible ───
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Reads (RLS filters the rows). Views are security_invoker, so the same policies apply.
grant select on
  public.organizations, public.profiles, public.memberships,
  public.regions, public.branches, public.borrowers, public.loans,
  public.district_boundaries, public.geofences, public.tags, public.animals,
  public.animal_geofence, public.fixes, public.alerts, public.alert_events,
  public.platform_admins, public.platform_audit_log,
  public.animal_overview, public.alert_overview, public.alert_audit,
  public.geofence_overview, public.geofence_detail,
  public.district_boundary_features, public.kpi_summary
to authenticated;

-- Writes (the matching policy still has to say yes).
grant insert, update, delete on
  public.regions, public.branches, public.borrowers, public.loans, public.tags,
  public.animals, public.animal_geofence, public.geofences
to authenticated;

grant insert, delete on public.memberships to authenticated;
grant update (role, region_id, branch_id) on public.memberships to authenticated;

-- Name, branding and settings only; slug and status stay out of the organization's reach.
grant update (name, logo_url, brand_settings, settings) on public.organizations to authenticated;
grant update (full_name, phone, updated_at) on public.profiles to authenticated;

-- Alert workflow columns only: type, severity, title, animal and organization are immutable.
grant update (
  status, assignee_id, acknowledged_at, assigned_at, resolved_at,
  resolution_reason, resolution_note
) on public.alerts to authenticated;

grant insert on public.alert_events to authenticated;
grant insert on public.platform_audit_log to authenticated;

-- Functions callable by signed-in users. create_geofence is SECURITY INVOKER, so its insert
-- goes through the geofences policy (org_admin only).
grant execute on function
  public.is_platform_admin(), public.current_org_ids(),
  public.has_any_role(uuid, public.org_role[]), public.has_role(uuid, public.org_role),
  public.can_see_whole_org(uuid), public.user_branch_scope(), public.org_member_ids(),
  public.create_geofence(uuid, text, public.fence_type, integer, text, jsonb,
                         double precision, double precision, double precision)
to authenticated;

-- The service role (ingestion, scripts) keeps everything.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
