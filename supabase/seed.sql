-- BovineSense — demo seed: two organizations so tenant isolation can be tested.
--
--   Bank of Punjab  (slug bank-of-punjab)  pilot data: 240 simulated animals, 3 districts
--                                      (Lahore 100, Faisalabad 80, Sahiwal 60)
--   Demo Bank       (slug demo-bank)       small dataset: 14 simulated animals, 2 districts
--
-- Each animal gets borrower -> loan -> tag -> animal -> first fix -> active
-- district geofence, all stamped with its organization_id.
--
-- Demo Bank deliberately reuses Bank of Punjab's region names and branch codes
-- (LHE-001, MLT-001): that only works because those are now unique per
-- organization, and it gives isolation tests overlapping data to trip over.
--
-- Run it AFTER `npm run import:boundaries` so the district fences use the real
-- polygons; without boundaries it falls back to a rough bounding box per district.
--
-- Idempotent per organization: an organization that already has animals is
-- skipped. Never deletes anything. The one real (non-simulated) demo tag is reserved separately:
-- `npm run seed:real-tag` (reads REAL_TAG_SERIAL). No auth users or memberships are created; see
-- "Add a member" in the README.

do $seed$
declare
  d              record;
  v_to_seed      uuid[];
  v_prev_org     uuid;
  v_region_id    integer;
  v_branch_id    integer;
  v_fence_id     integer;
  v_borrower_id  integer;
  v_loan_id      integer;
  v_tag_id       integer;
  v_animal_id    integer;
  v_idx          integer := 0;
  v_lat          double precision;
  v_lon          double precision;
  v_first_names  text[] := array['Muhammad','Ali','Tariq','Khalid','Usman','Hassan','Bilal','Imran','Adnan','Sajid',
                                 'Fatima','Sana','Razia','Nadia','Amna','Zainab','Rabia','Ayesha','Sadia','Noor'];
  v_last_names   text[] := array['Khan','Ahmad','Malik','Sheikh','Chaudhry','Butt','Hussain','Rana','Nawaz','Akbar',
                                 'Qureshi','Ansari','Bhatti','Gillani','Hashmi','Mirza','Raja','Siddiqui','Memon','Lodhi'];
  v_cnic_prefix  text[] := array['34201','35201','36201','31201','33201'];
begin
  -- Organizations
  insert into public.organizations (name, slug, settings)
  values
    ('Bank of Punjab', 'bank-of-punjab',
     '{"timezone": "Asia/Karachi", "demo_mode": true}'::jsonb),
    ('Demo Bank', 'demo-bank',
     '{"timezone": "Asia/Karachi", "demo_mode": true}'::jsonb)
  on conflict (slug) do nothing;

  -- Only seed organizations that have no animals yet.
  select array_agg(o.id)
  into v_to_seed
  from public.organizations o
  where o.slug in ('bank-of-punjab', 'demo-bank')
    and not exists (select 1 from public.animals a where a.organization_id = o.id);

  if v_to_seed is null then
    raise notice 'Seed skipped: both organizations already have animals.';
    return;
  end if;

  for d in
    select o.id as org_id, t.*
    from (values
      -- org slug, district, region, branch, branch code, animals, centre lat/lon, spread lat/lon, loan prefix, tag prefix, tag digits
      ('bank-of-punjab', 'Lahore',     'Central Punjab', 'Lahore Main',     'LHE-001', 100, 31.52, 74.36, 0.20, 0.25, 'LN-2024-', 'SIM-',  5),
      ('bank-of-punjab', 'Faisalabad', 'Central Punjab', 'Faisalabad Main', 'FSD-001',  80, 31.42, 73.08, 0.28, 0.32, 'LN-2024-', 'SIM-',  5),
      ('bank-of-punjab', 'Sahiwal',    'Central Punjab', 'Sahiwal Main',    'SWL-001',  60, 30.67, 73.11, 0.18, 0.22, 'LN-2024-', 'SIM-',  5),
      ('demo-bank',      'Lahore',     'Central Punjab', 'Lahore Main',     'LHE-001',  8, 31.52, 74.36, 0.20, 0.25, 'DB-2024-', 'SIM-D', 4),
      ('demo-bank',      'Multan',     'South Punjab',   'Multan Main',     'MLT-001',  6, 30.16, 71.52, 0.24, 0.26, 'DB-2024-', 'SIM-D', 4)
    ) as t (org_slug, district, region, branch, branch_code, cnt, clat, clon, dlat, dlon,
            loan_prefix, tag_prefix, tag_digits)
    join public.organizations o on o.slug = t.org_slug
  loop
    if not (d.org_id = any (v_to_seed)) then
      continue;
    end if;

    -- Numbering (loan numbers, tag serials) restarts for each organization.
    if v_prev_org is distinct from d.org_id then
      v_idx := 0;
      v_prev_org := d.org_id;
    end if;

    -- Region (shared between this organization's districts) and branch
    insert into public.regions (organization_id, name, code)
    values (d.org_id, d.region, upper(regexp_replace(d.region, '\s+', '_', 'g')))
    on conflict (organization_id, name) do update set name = excluded.name
    returning id into v_region_id;

    insert into public.branches (organization_id, name, code, region_id, district)
    values (d.org_id, d.branch, d.branch_code, v_region_id, d.district)
    on conflict (organization_id, code) do update set name = excluded.name
    returning id into v_branch_id;

    -- District fence: real polygon if imported, else a bounding box. Every
    -- organization gets its own fence row (fences are tenant data).
    v_fence_id := null;
    insert into public.geofences (organization_id, name, type, geom, warning_buffer_m, district_name)
    select d.org_id, d.district || ' District', 'district', b.geom, 500, d.district
    from public.district_boundaries b
    where b.district_name = d.district
    limit 1
    returning id into v_fence_id;

    if v_fence_id is null then
      raise notice 'No boundary for %, using an approximate bounding box.', d.district;
      insert into public.geofences (organization_id, name, type, geom, warning_buffer_m, district_name)
      values (
        d.org_id, d.district || ' District', 'district',
        extensions.st_makeenvelope(d.clon - d.dlon, d.clat - d.dlat,
                                   d.clon + d.dlon, d.clat + d.dlat, 4326),
        500, d.district
      )
      returning id into v_fence_id;
    end if;

    for i in 1 .. d.cnt loop
      v_idx := v_idx + 1;
      v_lat := d.clat + (random() * 1.4 - 0.7) * d.dlat;
      v_lon := d.clon + (random() * 1.4 - 0.7) * d.dlon;

      insert into public.borrowers (organization_id, name, cnic, phone, district, branch_id)
      values (
        d.org_id,
        v_first_names[1 + floor(random() * 20)::integer] || ' ' ||
          v_last_names[1 + floor(random() * 20)::integer],
        v_cnic_prefix[1 + floor(random() * 5)::integer] || '-' ||
          (1000000 + floor(random() * 9000000)::integer)::text || '-' ||
          (1 + floor(random() * 9)::integer)::text,
        '03' || (10 + floor(random() * 40)::integer)::text ||
          (1000000 + floor(random() * 9000000)::integer)::text,
        d.district,
        v_branch_id
      )
      returning id into v_borrower_id;

      insert into public.loans (organization_id, loan_number, borrower_id, branch_id, amount_pkr, disbursed_at, status)
      values (
        d.org_id,
        d.loan_prefix || upper(left(d.district, 3)) || '-' || lpad(v_idx::text, 4, '0'),
        v_borrower_id,
        v_branch_id,
        200000 + floor(random() * 1300001)::integer,
        now() - interval '1 year' * random(),
        'active'
      )
      returning id into v_loan_id;

      insert into public.tags (organization_id, serial_number, is_simulated, last_seen_at)
      values (
        d.org_id,
        d.tag_prefix || lpad(v_idx::text, d.tag_digits, '0'),
        true,
        now() - interval '10 minutes' * (random() * 6)
      )
      returning id into v_tag_id;

      insert into public.animals (organization_id, name, species, sex, age_years, tag_id, borrower_id, loan_id, branch_id, district, status, created_at)
      values (
        d.org_id,
        'Animal-' || lpad(v_idx::text, 3, '0'),
        'cattle',
        case when random() > 0.4 then 'female' else 'male' end,
        (1.5 + random() * 6.5)::real,
        v_tag_id, v_borrower_id, v_loan_id, v_branch_id, d.district, 'inside',
        now() - interval '30 days' - interval '1 day' * floor(random() * 60)
      )
      returning id into v_animal_id;

      insert into public.fixes (organization_id, tag_id, animal_id, lat, lon, fixed_at, battery_pct, signal_bars, is_simulated)
      values (
        d.org_id, v_tag_id, v_animal_id, v_lat, v_lon,
        now() - interval '10 minutes' * (random() * 3),
        30 + floor(random() * 66)::integer,
        2 + floor(random() * 3)::integer,
        true
      );

      insert into public.animal_geofence (organization_id, animal_id, geofence_id, is_active)
      values (d.org_id, v_animal_id, v_fence_id, true);
    end loop;

    raise notice '% / % : % animals', d.org_slug, d.district, d.cnt;
  end loop;

  raise notice 'Seed complete.';
end
$seed$;
