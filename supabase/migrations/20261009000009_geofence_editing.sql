-- BovineSense — geofence drawing and editing on the Google map.
--
--   * A radius fence now remembers its centre and radius (center_lat, center_lon, radius_m), so it can
--     be edited as a circle. Until now only the buffered polygon was kept. Existing radius fences
--     have no stored centre; the editor derives one from their outline.
--   * create_geofence() and the new update_geofence() share one geometry builder that VALIDATES what
--     the browser draws: a polygon must be a valid polygon (not crossing itself) of a sane size, a
--     radius between 50 m and 100 km, a warning buffer between 50 m and 5 km.
--   * update_geofence() is SECURITY INVOKER, so Row Level Security decides who may change a fence:
--     only organization admins (the geofences_update policy). Another organization's fence looks like
--     "not found", a fence the caller may see but not change is refused with 42501.
--   * geofence_detail also returns the centre and radius.
--
-- Error codes (PostgREST error.code): P0002 not found, 22023 invalid input, 42501 not permitted.

alter table public.geofences
  add column center_lat double precision,
  add column center_lon double precision,
  add column radius_m   double precision,
  add constraint geofences_radius_consistent check (
    (center_lat is null and center_lon is null and radius_m is null)
    or (center_lat between -90 and 90 and center_lon between -180 and 180 and radius_m between 50 and 100000)
  );

-- ─── One place that turns what the browser sends into a stored geometry ───────────────────────
create function public.build_fence_geometry(
  p_type       public.fence_type,
  p_district   text,
  p_geojson    jsonb,
  p_center_lat double precision,
  p_center_lon double precision,
  p_radius_m   double precision
)
returns extensions.geometry
language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_geom extensions.geometry;
begin
  if p_type = 'district' then
    select b.geom into v_geom
    from public.district_boundaries b
    where b.district_name = p_district
    limit 1;
    if v_geom is null then
      raise exception 'District not found' using errcode = 'P0002';
    end if;

  elsif p_type = 'polygon' then
    if p_geojson is null then
      raise exception 'geojson required for polygon type' using errcode = '22023';
    end if;
    begin
      v_geom := extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson::text), 4326);
    exception when others then
      raise exception 'The shape is not valid GeoJSON' using errcode = '22023';
    end;
    if extensions.st_geometrytype(v_geom) not in ('ST_Polygon', 'ST_MultiPolygon') then
      raise exception 'A polygon fence needs a polygon' using errcode = '22023';
    end if;
    if extensions.st_npoints(v_geom) > 2000 then
      raise exception 'The polygon has too many points (at most 2000)' using errcode = '22023';
    end if;
    if not extensions.st_isvalid(v_geom) then
      raise exception 'The polygon is not valid: its edges cross each other' using errcode = '22023';
    end if;

  elsif p_type = 'radius' then
    if p_center_lat is null or p_center_lon is null or p_radius_m is null then
      raise exception 'center_lat, center_lon, radius_m required for radius type' using errcode = '22023';
    end if;
    if p_center_lat not between -90 and 90 or p_center_lon not between -180 and 180 then
      raise exception 'The centre is not a valid coordinate' using errcode = '22023';
    end if;
    if p_radius_m not between 50 and 100000 then
      raise exception 'The radius must be between 50 m and 100 km' using errcode = '22023';
    end if;
    v_geom := extensions.st_buffer(
      extensions.st_setsrid(extensions.st_makepoint(p_center_lon, p_center_lat), 4326)
        ::extensions.geography,
      p_radius_m
    )::extensions.geometry;
  end if;

  return v_geom;
end;
$$;

-- ─── create_geofence: same signature, now validating and keeping the centre / radius ──────────
create or replace function public.create_geofence(
  p_organization_id  uuid,
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
  if p_name is null or btrim(p_name) = '' then
    raise exception 'A fence needs a name' using errcode = '22023';
  end if;
  if p_warning_buffer_m not between 50 and 5000 then
    raise exception 'The warning buffer must be between 50 m and 5 km' using errcode = '22023';
  end if;

  v_geom := public.build_fence_geometry(p_type, p_district_name, p_geojson, p_center_lat, p_center_lon, p_radius_m);

  insert into public.geofences (organization_id, name, type, geom, warning_buffer_m, district_name,
                                center_lat, center_lon, radius_m)
  values (p_organization_id, btrim(p_name), p_type, v_geom, p_warning_buffer_m, p_district_name,
          case when p_type = 'radius' then p_center_lat end,
          case when p_type = 'radius' then p_center_lon end,
          case when p_type = 'radius' then p_radius_m end)
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── update_geofence ──────────────────────────────────────────────────────────────────────────
-- Only the arguments that are given change. Reshaping needs the shape that fits the fence's type: a
-- polygon fence takes p_geojson, a radius fence takes centre and radius together, and a district
-- fence cannot be reshaped (it follows its district's boundary).
create function public.update_geofence(
  p_id               integer,
  p_name             text default null,
  p_warning_buffer_m integer default null,
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
  v_type    public.fence_type;
  v_geom    extensions.geometry;
  v_n       integer;
  v_reshape boolean := p_geojson is not null or p_center_lat is not null
                       or p_center_lon is not null or p_radius_m is not null;
begin
  -- Row Level Security: only fences the caller can see are found at all.
  select g.type into v_type from public.geofences g where g.id = p_id;
  if not found then
    raise exception 'Geofence not found' using errcode = 'P0002';
  end if;

  if p_name is not null and btrim(p_name) = '' then
    raise exception 'A fence needs a name' using errcode = '22023';
  end if;
  if p_warning_buffer_m is not null and p_warning_buffer_m not between 50 and 5000 then
    raise exception 'The warning buffer must be between 50 m and 5 km' using errcode = '22023';
  end if;

  if v_reshape then
    if v_type = 'district' then
      raise exception 'A district fence follows its district boundary and cannot be reshaped' using errcode = '22023';
    end if;
    v_geom := public.build_fence_geometry(v_type, null, p_geojson, p_center_lat, p_center_lon, p_radius_m);
  end if;

  update public.geofences g
  set name             = coalesce(btrim(p_name), g.name),
      warning_buffer_m = coalesce(p_warning_buffer_m, g.warning_buffer_m),
      geom             = coalesce(v_geom, g.geom),
      center_lat       = case when v_type = 'radius' and v_reshape then p_center_lat else g.center_lat end,
      center_lon       = case when v_type = 'radius' and v_reshape then p_center_lon else g.center_lon end,
      radius_m         = case when v_type = 'radius' and v_reshape then p_radius_m   else g.radius_m   end
  where g.id = p_id;
  get diagnostics v_n = row_count;

  -- A refused UPDATE matches no rows and raises nothing, so say so.
  if v_n = 0 then
    raise exception 'Not permitted to change this geofence' using errcode = '42501';
  end if;
  return p_id;
end;
$$;

-- ─── The detail view also carries the centre and radius ───────────────────────────────────────
create or replace view public.geofence_detail with (security_invoker = true) as
select
  g.id,
  g.organization_id,
  g.name,
  g.type,
  g.warning_buffer_m,
  g.district_name,
  g.created_at,
  extensions.st_asgeojson(g.geom)::json as geojson,
  g.center_lat,
  g.center_lon,
  g.radius_m
from public.geofences g;

-- ─── Privileges ───────────────────────────────────────────────────────────────────────────────
-- Signed-in users call these (as themselves: RLS decides). Nobody anonymous.
revoke execute on function
  public.build_fence_geometry(public.fence_type, text, jsonb, double precision, double precision, double precision),
  public.update_geofence(integer, text, integer, jsonb, double precision, double precision, double precision)
from public, anon;

grant execute on function
  public.build_fence_geometry(public.fence_type, text, jsonb, double precision, double precision, double precision),
  public.update_geofence(integer, text, integer, jsonb, double precision, double precision, double precision)
to authenticated, service_role;
