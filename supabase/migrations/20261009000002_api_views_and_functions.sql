-- BovineSense — read views and RPC functions used by the Next.js API routes.
--
-- supabase-js talks to Postgres through PostgREST, which cannot express the
-- lateral joins, CASE orderings or PostGIS calls the old raw-SQL routes used.
-- Those queries now live here as views / functions and the routes filter them.
--
-- Security model for this migration:
--   * every view is security_invoker, so the caller's RLS applies (anon and
--     authenticated currently get nothing);
--   * every function is executable only by service_role;
--   * object names inside function bodies are fully qualified so they do not
--     depend on the caller's search_path.
-- The auth/tenancy module will add RLS policies and re-grant what it needs.

-- ─── Views ───────────────────────────────────────────────────────────────────

-- One wide row per animal: borrower, loan, branch/region, active fence, latest
-- fix. Serves the animals table, map markers, search, drawer and alert engine.
create view public.animal_overview with (security_invoker = true) as
select
  a.id,
  a.name                    as animal_name,
  a.species,
  a.sex,
  a.age_years,
  a.status,
  case a.status
    when 'breach' then 0 when 'near' then 1 when 'fast' then 2 when 'inside' then 3
    else 4
  end                       as status_rank,
  a.district,
  a.tag_id,
  t.serial_number           as tag_serial,
  t.is_simulated            as tag_is_simulated,
  t.last_seen_at            as tag_last_seen_at,
  a.borrower_id,
  bo.name                   as borrower_name,
  bo.cnic,
  bo.phone,
  bo.address,
  a.loan_id,
  l.loan_number,
  l.amount_pkr,
  l.disbursed_at,
  l.status                  as loan_status,
  a.branch_id,
  br.name                   as branch_name,
  r.id                      as region_id,
  r.name                    as region_name,
  g.id                      as geofence_id,
  g.name                    as geofence_name,
  g.warning_buffer_m,
  f.lat,
  f.lon,
  f.fixed_at                as last_fix_at,
  f.battery_pct,
  f.speed_kmh,
  f.signal_bars,
  exists (
    select 1 from public.alerts al
    where al.animal_id = a.id and al.type = 'breach' and al.status = 'new'
  )                         as has_unack_breach
from public.animals a
left join public.tags t          on t.id = a.tag_id
left join public.borrowers bo    on bo.id = a.borrower_id
left join public.loans l         on l.id = a.loan_id
join      public.branches br     on br.id = a.branch_id
left join public.regions r       on r.id = br.region_id
left join public.animal_geofence ag on ag.animal_id = a.id and ag.is_active
left join public.geofences g     on g.id = ag.geofence_id
left join lateral (
  select fx.lat, fx.lon, fx.fixed_at, fx.battery_pct, fx.speed_kmh, fx.signal_bars
  from public.fixes fx
  where fx.animal_id = a.id
  order by fx.fixed_at desc
  limit 1
) f on true;

-- One row per alert with the animal / borrower / branch context the feed shows.
create view public.alert_overview with (security_invoker = true) as
select
  al.id,
  al.type,
  al.severity,
  al.status,
  case al.status
    when 'new' then 0 when 'acknowledged' then 1 when 'assigned' then 2 else 3
  end                       as status_rank,
  case al.severity
    when 'critical' then 0 when 'warning' then 1 else 2
  end                       as severity_rank,
  al.title,
  al.detail,
  al.distance_km,
  al.created_at,
  al.acknowledged_at,
  al.assigned_at,
  al.resolved_at,
  al.resolution_reason,
  al.resolution_note,
  al.assignee_id,
  a.id                      as animal_id,
  a.name                    as animal_name,
  a.status                  as animal_status,
  t.serial_number           as tag_serial,
  bo.id                     as borrower_id,
  bo.name                   as borrower_name,
  l.loan_number,
  br.id                     as branch_id,
  br.name                   as branch_name,
  r.id                      as region_id,
  r.name                    as region_name
from public.alerts al
join      public.animals a    on a.id = al.animal_id
left join public.tags t       on t.id = al.tag_id
left join public.borrowers bo on bo.id = a.borrower_id
left join public.loans l      on l.id = a.loan_id
join      public.branches br  on br.id = a.branch_id
left join public.regions r    on r.id = br.region_id;

-- Audit trail of alert status changes with the actor's name.
create view public.alert_audit with (security_invoker = true) as
select
  ae.id,
  ae.alert_id,
  ae.from_status,
  ae.to_status,
  ae.note,
  ae.created_at,
  ae.user_id,
  u.name                    as user_name
from public.alert_events ae
left join public.users u on u.id = ae.user_id;

-- Geofences with how many animals use them and how many have an unacknowledged breach.
create view public.geofence_overview with (security_invoker = true) as
select
  g.id,
  g.name,
  g.type,
  g.warning_buffer_m,
  g.district_name,
  g.created_at,
  (count(distinct ag.animal_id) filter (where ag.is_active))::integer  as animal_count,
  (count(distinct al.id) filter (where al.status = 'new' and al.type = 'breach'))::integer
                                                                       as breach_count
from public.geofences g
left join public.animal_geofence ag on ag.geofence_id = g.id
left join public.animals a          on a.id = ag.animal_id and ag.is_active
left join public.alerts al          on al.animal_id = a.id and al.status <> 'resolved'
group by g.id;

-- A geofence with its geometry as GeoJSON.
create view public.geofence_detail with (security_invoker = true) as
select
  g.id,
  g.name,
  g.type,
  g.warning_buffer_m,
  g.district_name,
  g.created_at,
  extensions.st_asgeojson(g.geom)::json as geojson
from public.geofences g;

-- District polygons as GeoJSON geometry (the map boundary layer).
create view public.district_boundary_features with (security_invoker = true) as
select
  b.id,
  b.district_name,
  b.province,
  extensions.st_asgeojson(b.geom)::json as geometry
from public.district_boundaries b;

-- Single-row dashboard KPIs.
create view public.kpi_summary with (security_invoker = true) as
select
  (count(*))::integer                                              as total,
  (count(*) filter (where status = 'inside'))::integer             as inside_count,
  (count(*) filter (where status = 'breach'))::integer             as breach_count,
  (count(*) filter (where status = 'stale'))::integer              as stale_count,
  (coalesce(round(100.0 * count(*) filter (where status = 'inside')
                  / nullif(count(*), 0)), 0))::integer             as inside_pct,
  (select count(*) from public.alerts
   where status in ('new', 'acknowledged'))::integer               as new_alerts
from public.animals;

-- ─── Functions ───────────────────────────────────────────────────────────────

-- Where a point sits relative to a fence. Used by the alert engine.
create function public.fence_spatial_context(
  p_geofence_id integer,
  p_lon         double precision,
  p_lat         double precision
)
returns table (
  inside_fence   boolean,
  metres_outside double precision,
  metres_to_edge double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    extensions.st_contains(g.geom, pt.p),
    extensions.st_distance(g.geom::extensions.geography, pt.p::extensions.geography),
    extensions.st_distance(extensions.st_boundary(g.geom)::extensions.geography,
                           pt.p::extensions.geography)
  from public.geofences g
  cross join lateral (
    select extensions.st_setsrid(extensions.st_point(p_lon, p_lat), 4326) as p
  ) pt
  where g.id = p_geofence_id;
$$;

-- True when the animal has any earlier fix (id < p_fix_id) outside the fence.
-- NOTE: faithful port of the old engine query. It does not require that fix to
-- be the immediately preceding one; the alert-engine module tightens this.
create function public.animal_has_prior_outside_fix(
  p_animal_id   integer,
  p_fix_id      integer,
  p_geofence_id integer
)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.fixes f
    where f.animal_id = p_animal_id
      and f.id < p_fix_id
      and not extensions.st_contains(
            (select g.geom from public.geofences g where g.id = p_geofence_id),
            f.geom)
  );
$$;

-- Animals whose tag has not reported within the threshold and are not yet stale.
create function public.find_offline_animals(p_threshold_hours integer default 6)
returns table (
  animal_id     integer,
  animal_name   varchar,
  tag_id        integer,
  borrower_name varchar,
  loan_number   varchar,
  branch_id     integer,
  region_id     integer
)
language sql
stable
set search_path = public, extensions
as $$
  select a.id, a.name, t.id, b.name, l.loan_number, br.id, r.id
  from public.animals a
  join      public.tags t       on t.id = a.tag_id
  left join public.borrowers b  on b.id = a.borrower_id
  left join public.loans l      on l.id = a.loan_id
  join      public.branches br  on br.id = a.branch_id
  left join public.regions r    on r.id = br.region_id
  where a.status <> 'stale'
    and (t.last_seen_at is null
         or t.last_seen_at < now() - make_interval(hours => p_threshold_hours));
$$;

-- Create a geofence of any type and return its id.
-- Error codes (surfaced by PostgREST as error.code):
--   P0002  district not found      22023  missing / invalid input
create function public.create_geofence(
  p_name             text,
  p_type             public.fence_type,
  p_warning_buffer_m integer default 500,
  p_district_name    text default null,
  p_geojson          jsonb default null,
  p_center_lat       double precision default null,
  p_center_lon       double precision default null,
  p_radius_m         double precision default null
)
returns integer
language plpgsql
set search_path = public, extensions
as $$
declare
  v_geom extensions.geometry;
  v_id   integer;
begin
  if p_type = 'district' then
    select b.geom into v_geom
    from public.district_boundaries b
    where b.district_name = p_district_name
    limit 1;
    if v_geom is null then
      raise exception 'District not found' using errcode = 'P0002';
    end if;
  elsif p_type = 'polygon' then
    if p_geojson is null then
      raise exception 'geojson required for polygon type' using errcode = '22023';
    end if;
    v_geom := extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson::text), 4326);
  elsif p_type = 'radius' then
    if p_center_lat is null or p_center_lon is null or p_radius_m is null then
      raise exception 'center_lat, center_lon, radius_m required for radius type'
        using errcode = '22023';
    end if;
    v_geom := extensions.st_buffer(
      extensions.st_setsrid(extensions.st_makepoint(p_center_lon, p_center_lat), 4326)
        ::extensions.geography,
      p_radius_m
    )::extensions.geometry;
  end if;

  insert into public.geofences (name, type, geom, warning_buffer_m, district_name)
  values (p_name, p_type, v_geom, p_warning_buffer_m, p_district_name)
  returning id into v_id;

  return v_id;
end;
$$;

-- Insert or update one district polygon (used by scripts/import-boundaries.ts).
create function public.import_district_boundary(
  p_name     text,
  p_province text,
  p_gid      text,
  p_geojson  jsonb
)
returns void
language sql
set search_path = public, extensions
as $$
  insert into public.district_boundaries (district_name, province, gadm_gid, geom)
  values (
    p_name,
    p_province,
    p_gid,
    extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson::text), 4326)
  )
  on conflict (gadm_gid) do update
    set district_name = excluded.district_name,
        province      = excluded.province,
        geom          = excluded.geom;
$$;

-- ─── Lock the Data API down until the auth module adds policies ─────────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
