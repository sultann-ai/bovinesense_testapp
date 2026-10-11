-- BovineSense — demo state: make the Overview show real exceptions on first load.
--
-- Run it AFTER supabase/seed.sql (SQL Editor, or `npx supabase db query --linked -f supabase/seed_demo_state.sql`).
-- For Bank of Punjab's 240 simulated animals it produces, through the real rules (ingest_fix and
-- check_offline_tags), so alerts, statuses and audit rows are exactly what live data would create:
--
--     4 breaches            (a fix 1.5 km outside the district fence)
--    10 near boundary       (a fix 250 m inside the fence edge, inside the 500 m warning buffer)
--     2 fast movement       (a fix reporting 45 km/h)
--     5 offline             (last fix 8 h ago, past the 6 h default threshold)
--
-- spread over Lahore, Faisalabad and Sahiwal. The other 219 stay inside.
--
-- Safe to run twice: it does nothing when Bank of Punjab already has any alert. It touches no other
-- organization and writes no secrets (it makes a throwaway device key and revokes it at the end).
-- The simulator (scripts/simulate.ts) leaves these exception animals alone, so the picture stays.

do $demo$
declare
  v_org     uuid;
  v_key     uuid;
  v_geom    extensions.geometry;
  v_ring    extensions.geometry;
  v_pt      extensions.geometry;
  v_n       integer;
  r         record;
begin
  select o.id into v_org from public.organizations o where o.slug = 'bank-of-punjab';
  if v_org is null then
    raise notice 'Demo state skipped: Bank of Punjab does not exist (run supabase/seed.sql first).';
    return;
  end if;
  if exists (select 1 from public.alerts a where a.organization_id = v_org) then
    raise notice 'Demo state skipped: Bank of Punjab already has alerts.';
    return;
  end if;

  -- A throwaway key so ingest_fix accepts the calls; revoked below.
  insert into public.device_api_keys (organization_id, key_hash, key_prefix, label)
  values (v_org, encode(sha256(convert_to(gen_random_uuid()::text, 'utf8')), 'hex'), 'bsk_demo', 'Demo state (temporary)')
  returning id into v_key;

  for r in
    with plan(district, kind, kind_order, cnt) as (
      values
        ('Lahore',     'breach',  1, 2), ('Lahore',     'near', 2, 4), ('Lahore',     'fast', 3, 1), ('Lahore',     'offline', 4, 2),
        ('Faisalabad', 'breach',  1, 1), ('Faisalabad', 'near', 2, 3), ('Faisalabad', 'fast', 3, 1), ('Faisalabad', 'offline', 4, 2),
        ('Sahiwal',    'breach',  1, 1), ('Sahiwal',    'near', 2, 3),                                ('Sahiwal',    'offline', 4, 1)
    ),
    slots as (
      select p.district, p.kind,
             row_number() over (partition by p.district order by p.kind_order, g) as rn
      from plan p, lateral generate_series(1, p.cnt) g
    ),
    animals_ranked as (
      select a.id as animal_id, a.district, t.id as tag_id, t.serial_number,
             row_number() over (partition by a.district order by a.id) as rn
      from public.animals a
      join public.tags t on t.id = a.tag_id and t.organization_id = a.organization_id
      where a.organization_id = v_org and t.is_simulated
    )
    select s.kind, s.rn, ar.animal_id, ar.tag_id, ar.serial_number
    from slots s
    join animals_ranked ar on ar.district = s.district and ar.rn = s.rn
    order by s.district, s.rn
  loop
    if r.kind in ('breach', 'near') then
      select g.geom into v_geom
      from public.animal_geofence ag
      join public.geofences g on g.id = ag.geofence_id
      where ag.animal_id = r.animal_id and ag.is_active
      limit 1;
      continue when v_geom is null;

      -- breach: a point on a ring 1.5 km outside the fence; near: on a ring 250 m inside it.
      v_ring := extensions.st_exteriorring(
        (extensions.st_dump(
           extensions.st_buffer(v_geom::extensions.geography, case when r.kind = 'breach' then 1500 else -250 end)::extensions.geometry
        )).geom);
      v_n  := greatest(extensions.st_npoints(v_ring), 1);
      v_pt := extensions.st_pointn(v_ring, (1 + (r.rn * 53) % v_n)::integer);
      perform public.ingest_fix(v_org, v_key, r.serial_number, extensions.st_y(v_pt), extensions.st_x(v_pt), now(), 3, 70, 3);

    elsif r.kind = 'fast' then
      -- Same place as its last fix, but the tag reports vehicle speed.
      perform public.ingest_fix(v_org, v_key, r.serial_number,
        (select f.lat from public.fixes f where f.animal_id = r.animal_id order by f.fixed_at desc limit 1),
        (select f.lon from public.fixes f where f.animal_id = r.animal_id order by f.fixed_at desc limit 1),
        now(), 45, 70, 3);

    else  -- offline: the tag last reported 8 hours ago
      update public.fixes set fixed_at = now() - interval '8 hours' - make_interval(mins => r.rn::int)
       where animal_id = r.animal_id;
      update public.tags set last_seen_at = now() - interval '8 hours' - make_interval(mins => r.rn::int)
       where id = r.tag_id;
    end if;
  end loop;

  -- Mark the offline animals and raise their alerts the way the scheduled job does.
  perform public.check_offline_tags(v_org);

  update public.device_api_keys set revoked_at = now() where id = v_key;

  raise notice 'Demo state created for Bank of Punjab.';
end
$demo$;
