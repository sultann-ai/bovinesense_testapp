-- BovineSense — checks that the database itself refuses cross-organization data.
--
-- Prerequisites: migrations applied and seed.sql run (both organizations exist).
-- Run: paste into the Supabase SQL Editor (or `psql -f`). It inserts nothing that
-- survives: every statement is expected to be rejected, and any check that is NOT
-- rejected aborts the whole script with a "FAILED:" message.
--
-- This tests constraints only (composite foreign keys, per-organization unique
-- keys, membership scope). Row Level Security has its own tests once policies exist.

do $test$
declare
  v_bop          uuid;
  v_demo         uuid;
  v_bop_region   integer;
  v_bop_branch   integer;
  v_bop_branch_code text;
  v_bop_borrower integer;
  v_bop_loan     integer;
  v_bop_tag      integer;
  v_bop_tag_serial text;
  v_bop_animal   integer;
  v_bop_fence    integer;
  v_bop_alert    integer;
  v_demo_branch  integer;
  v_demo_borrower integer;
  v_demo_animal  integer;
  v_user         uuid;
  v_passed       integer := 0;
begin
  select id into v_bop  from public.organizations where slug = 'bank-of-punjab';
  select id into v_demo from public.organizations where slug = 'demo-bank';
  if v_bop is null or v_demo is null then
    raise exception 'Seed both organizations first (supabase/seed.sql).';
  end if;

  select id into v_bop_region from public.regions where organization_id = v_bop limit 1;
  select id, code into v_bop_branch, v_bop_branch_code
    from public.branches where organization_id = v_bop limit 1;
  select id into v_bop_borrower from public.borrowers where organization_id = v_bop limit 1;
  select id into v_bop_loan from public.loans where organization_id = v_bop limit 1;
  select id, serial_number into v_bop_tag, v_bop_tag_serial
    from public.tags where organization_id = v_bop limit 1;
  select id into v_bop_animal from public.animals where organization_id = v_bop limit 1;
  select id into v_bop_fence from public.geofences where organization_id = v_bop limit 1;
  select id into v_bop_alert from public.alerts where organization_id = v_bop limit 1;

  select id into v_demo_branch from public.branches where organization_id = v_demo limit 1;
  select id into v_demo_borrower from public.borrowers where organization_id = v_demo limit 1;
  select id into v_demo_animal from public.animals where organization_id = v_demo limit 1;

  -- 1. branch -> region of another organization
  begin
    insert into public.branches (organization_id, name, code, region_id)
    values (v_demo, 'X', 'ZZZ-001', v_bop_region);
    raise exception 'FAILED: branch accepted another organization''s region' using errcode = 'XX999';
  exception when foreign_key_violation then v_passed := v_passed + 1; end;

  -- 2. loan -> borrower of another organization
  begin
    insert into public.loans (organization_id, loan_number, borrower_id, branch_id, amount_pkr)
    values (v_demo, 'ZZ-0001', v_bop_borrower, v_demo_branch, 1000);
    raise exception 'FAILED: loan accepted another organization''s borrower' using errcode = 'XX999';
  exception when foreign_key_violation then v_passed := v_passed + 1; end;

  -- 3. animal -> loan of another organization
  begin
    insert into public.animals (organization_id, borrower_id, branch_id, loan_id)
    values (v_demo, v_demo_borrower, v_demo_branch, v_bop_loan);
    raise exception 'FAILED: animal accepted another organization''s loan' using errcode = 'XX999';
  exception when foreign_key_violation then v_passed := v_passed + 1; end;

  -- 4. animal -> tag of another organization
  begin
    insert into public.animals (organization_id, borrower_id, branch_id, tag_id)
    values (v_demo, v_demo_borrower, v_demo_branch, v_bop_tag);
    raise exception 'FAILED: animal accepted another organization''s tag' using errcode = 'XX999';
  exception when foreign_key_violation then v_passed := v_passed + 1; end;

  -- 5. animal -> branch of another organization
  begin
    insert into public.animals (organization_id, borrower_id, branch_id)
    values (v_demo, v_demo_borrower, v_bop_branch);
    raise exception 'FAILED: animal accepted another organization''s branch' using errcode = 'XX999';
  exception when foreign_key_violation then v_passed := v_passed + 1; end;

  -- 6. fence assignment -> geofence of another organization
  begin
    insert into public.animal_geofence (organization_id, animal_id, geofence_id, is_active)
    values (v_demo, v_demo_animal, v_bop_fence, false);
    raise exception 'FAILED: fence assignment accepted another organization''s geofence' using errcode = 'XX999';
  exception when foreign_key_violation then v_passed := v_passed + 1; end;

  -- 7. fix -> tag of another organization
  begin
    insert into public.fixes (organization_id, tag_id, lat, lon, fixed_at)
    values (v_demo, v_bop_tag, 31.5, 74.3, now());
    raise exception 'FAILED: fix accepted another organization''s tag' using errcode = 'XX999';
  exception when foreign_key_violation then v_passed := v_passed + 1; end;

  -- 8. fix -> animal of another organization
  begin
    insert into public.fixes (organization_id, tag_id, animal_id, lat, lon, fixed_at)
    select v_demo, t.id, v_bop_animal, 31.5, 74.3, now()
    from public.tags t where t.organization_id = v_demo limit 1;
    raise exception 'FAILED: fix accepted another organization''s animal' using errcode = 'XX999';
  exception when foreign_key_violation then v_passed := v_passed + 1; end;

  -- 9. alert -> animal of another organization
  begin
    insert into public.alerts (organization_id, animal_id, type, severity, title)
    values (v_demo, v_bop_animal, 'breach', 'critical', 'x');
    raise exception 'FAILED: alert accepted another organization''s animal' using errcode = 'XX999';
  exception when foreign_key_violation then v_passed := v_passed + 1; end;

  -- 10. alert event -> alert of another organization
  if v_bop_alert is not null then
    begin
      insert into public.alert_events (organization_id, alert_id, to_status)
      values (v_demo, v_bop_alert, 'new');
      raise exception 'FAILED: alert event accepted another organization''s alert' using errcode = 'XX999';
    exception when foreign_key_violation then v_passed := v_passed + 1; end;
  else
    raise notice 'Skipped alert-event check: no alerts exist yet (run the simulator first).';
  end if;

  -- 11. uniqueness is per organization: a duplicate inside one organization is refused ...
  begin
    insert into public.branches (organization_id, name, code, region_id)
    values (v_bop, 'Dup', v_bop_branch_code, v_bop_region);
    raise exception 'FAILED: duplicate branch code accepted inside one organization' using errcode = 'XX999';
  exception when unique_violation then v_passed := v_passed + 1; end;

  -- 12. ... but tag serial numbers stay globally unique (ingestion resolves them alone)
  begin
    insert into public.tags (organization_id, serial_number)
    values (v_demo, v_bop_tag_serial);
    raise exception 'FAILED: tag serial reused across organizations' using errcode = 'XX999';
  exception when unique_violation then v_passed := v_passed + 1; end;

  -- 13. membership scope must match the role (CHECK fires before the foreign keys)
  begin
    insert into public.memberships (user_id, organization_id, role, region_id)
    values (gen_random_uuid(), v_demo, 'org_admin', 1);
    raise exception 'FAILED: org_admin accepted a region scope' using errcode = 'XX999';
  exception when check_violation then v_passed := v_passed + 1; end;

  -- 14. membership -> branch of another organization (needs a real auth user)
  select id into v_user from auth.users limit 1;
  if v_user is not null then
    begin
      insert into public.memberships (user_id, organization_id, role, branch_id)
      values (v_user, v_demo, 'branch_officer', v_bop_branch);
      raise exception 'FAILED: membership accepted another organization''s branch' using errcode = 'XX999';
    exception when foreign_key_violation then v_passed := v_passed + 1; end;
  else
    raise notice 'Skipped membership-branch check: no auth users exist yet.';
  end if;

  raise notice 'All % tenancy constraint checks passed.', v_passed;
end
$test$;
