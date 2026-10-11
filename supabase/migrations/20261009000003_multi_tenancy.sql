-- BovineSense — multi-tenancy.
--
-- Turns the single-bank schema into a multi-tenant one. Bank of Punjab becomes one
-- organization; any lender can be added as another.
--
--   * organizations, profiles (one per auth user) and memberships (user <-> org + role)
--   * organization_id NOT NULL + FK + index on every business table
--   * composite foreign keys, so a row can never point at a row of another
--     organization (an animal's loan, tag, branch, fence ... must share its org)
--   * uniqueness that used to be global (region name, branch code, loan number,
--     CNIC ...) is now per organization; tag serial numbers stay globally unique
--     because ingestion resolves a tag from its serial alone
--   * the old `users` table is replaced by profiles + memberships
--   * district_boundaries stays global reference data
--
-- Existing data: if any rows exist when this runs they are assigned to a new
-- 'bank-of-punjab' organization. The old users table cannot be mapped to Supabase
-- Auth, so it is dropped together with alerts.assignee_id and alert_events.user_id
-- (those columns are recreated empty with the new uuid type).
--
-- NOT in this migration: RLS policies. The new tables get RLS enabled with no
-- policies (deny-all) and no grants to anon/authenticated, exactly like the
-- existing tables; the app keeps using the server-only service-role client.

-- ─── 0. Drop what must be rebuilt ────────────────────────────────────────────
-- Views and functions whose definition or signature changes. The columns below
-- (alerts.assignee_id, alert_events.user_id) are also referenced by views.
drop view if exists public.alert_audit;
drop view if exists public.alert_overview;
drop view if exists public.animal_overview;
drop view if exists public.geofence_overview;
drop view if exists public.geofence_detail;

drop function if exists public.find_offline_animals(integer);
drop function if exists public.create_geofence(
  text, public.fence_type, integer, text, jsonb,
  double precision, double precision, double precision
);

-- ─── 1. Organizations, profiles ──────────────────────────────────────────────
create type public.org_role as enum (
  'org_admin', 'regional_manager', 'branch_officer', 'auditor'
);
create type public.org_status as enum ('active', 'suspended');

create table public.organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null,
  logo_url        text,
  -- Tenant theming. May override brand tokens only, never status tokens.
  brand_settings  jsonb not null default '{}'::jsonb,
  -- Operational settings: timezone, demo_mode, alert thresholds, service area ...
  settings        jsonb not null default '{}'::jsonb,
  status          public.org_status not null default 'active',
  created_at      timestamptz not null default now(),
  constraint organizations_slug_key unique (slug),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint organizations_name_not_blank check (btrim(name) <> '')
);

-- One row per Supabase Auth user. Global (not tenant-owned): a person can belong
-- to several organizations through memberships.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── 2. organization_id on every business table (nullable until backfilled) ──
alter table public.regions         add column organization_id uuid;
alter table public.branches        add column organization_id uuid;
alter table public.borrowers       add column organization_id uuid;
alter table public.loans           add column organization_id uuid;
alter table public.geofences       add column organization_id uuid;
alter table public.tags            add column organization_id uuid;
alter table public.animals         add column organization_id uuid;
alter table public.animal_geofence add column organization_id uuid;
alter table public.fixes           add column organization_id uuid;
alter table public.alerts          add column organization_id uuid;
alter table public.alert_events    add column organization_id uuid;

-- ─── 3. Backfill any pre-existing single-tenant data ─────────────────────────
do $$
declare
  v_org uuid;
begin
  if exists (select 1 from public.regions)
     or exists (select 1 from public.branches)
     or exists (select 1 from public.borrowers)
     or exists (select 1 from public.loans)
     or exists (select 1 from public.geofences)
     or exists (select 1 from public.tags)
     or exists (select 1 from public.animals)
     or exists (select 1 from public.animal_geofence)
     or exists (select 1 from public.fixes)
     or exists (select 1 from public.alerts)
     or exists (select 1 from public.alert_events)
  then
    insert into public.organizations (name, slug)
    values ('Bank of Punjab', 'bank-of-punjab')
    returning id into v_org;

    update public.regions         set organization_id = v_org;
    update public.branches        set organization_id = v_org;
    update public.borrowers       set organization_id = v_org;
    update public.loans           set organization_id = v_org;
    update public.geofences       set organization_id = v_org;
    update public.tags            set organization_id = v_org;
    update public.animals         set organization_id = v_org;
    update public.animal_geofence set organization_id = v_org;
    update public.fixes           set organization_id = v_org;
    update public.alerts          set organization_id = v_org;
    update public.alert_events    set organization_id = v_org;
  end if;
end
$$;

-- ─── 4. NOT NULL + FK to organizations + index ───────────────────────────────
alter table public.regions         alter column organization_id set not null;
alter table public.branches        alter column organization_id set not null;
alter table public.borrowers       alter column organization_id set not null;
alter table public.loans           alter column organization_id set not null;
alter table public.geofences       alter column organization_id set not null;
alter table public.tags            alter column organization_id set not null;
alter table public.animals         alter column organization_id set not null;
alter table public.animal_geofence alter column organization_id set not null;
alter table public.fixes           alter column organization_id set not null;
alter table public.alerts          alter column organization_id set not null;
alter table public.alert_events    alter column organization_id set not null;

alter table public.regions         add constraint regions_organization_fk         foreign key (organization_id) references public.organizations (id);
alter table public.branches        add constraint branches_organization_fk        foreign key (organization_id) references public.organizations (id);
alter table public.borrowers       add constraint borrowers_organization_fk       foreign key (organization_id) references public.organizations (id);
alter table public.loans           add constraint loans_organization_fk           foreign key (organization_id) references public.organizations (id);
alter table public.geofences       add constraint geofences_organization_fk       foreign key (organization_id) references public.organizations (id);
alter table public.tags            add constraint tags_organization_fk            foreign key (organization_id) references public.organizations (id);
alter table public.animals         add constraint animals_organization_fk         foreign key (organization_id) references public.organizations (id);
alter table public.animal_geofence add constraint animal_geofence_organization_fk foreign key (organization_id) references public.organizations (id);
alter table public.fixes           add constraint fixes_organization_fk           foreign key (organization_id) references public.organizations (id);
alter table public.alerts          add constraint alerts_organization_fk          foreign key (organization_id) references public.organizations (id);
alter table public.alert_events    add constraint alert_events_organization_fk    foreign key (organization_id) references public.organizations (id);

create index regions_organization_id_idx         on public.regions (organization_id);
create index branches_organization_id_idx        on public.branches (organization_id);
create index borrowers_organization_id_idx       on public.borrowers (organization_id);
create index loans_organization_id_idx           on public.loans (organization_id);
create index geofences_organization_id_idx       on public.geofences (organization_id);
create index tags_organization_id_idx            on public.tags (organization_id);
create index animals_organization_id_idx         on public.animals (organization_id);
create index animal_geofence_organization_id_idx on public.animal_geofence (organization_id);
create index fixes_organization_id_idx           on public.fixes (organization_id);
create index alerts_organization_id_idx          on public.alerts (organization_id);
create index alert_events_organization_id_idx    on public.alert_events (organization_id);

-- ─── 5. Per-organization uniqueness ──────────────────────────────────────────
-- Global uniques become per-organization. (Inline UNIQUE constraints were named
-- <table>_<column>_key by Postgres.) tags.serial_number stays globally unique.
alter table public.regions   drop constraint if exists regions_name_key;
alter table public.regions   drop constraint if exists regions_code_key;
alter table public.branches  drop constraint if exists branches_code_key;
alter table public.borrowers drop constraint if exists borrowers_cnic_key;
alter table public.loans     drop constraint if exists loans_loan_number_key;

alter table public.regions   add constraint regions_org_name_key        unique (organization_id, name);
alter table public.regions   add constraint regions_org_code_key        unique (organization_id, code);
alter table public.branches  add constraint branches_org_code_key       unique (organization_id, code);
alter table public.borrowers add constraint borrowers_org_cnic_key      unique (organization_id, cnic);
alter table public.loans     add constraint loans_org_loan_number_key   unique (organization_id, loan_number);

-- ─── 6. Composite keys: a row can only reference rows of its own organization ─
-- Every parent exposes UNIQUE (organization_id, id); every child references that
-- pair, so child.organization_id must equal parent.organization_id. Nullable
-- reference columns (MATCH SIMPLE) are simply not checked while NULL.
alter table public.regions   add constraint regions_org_id_key   unique (organization_id, id);
alter table public.branches  add constraint branches_org_id_key  unique (organization_id, id);
alter table public.borrowers add constraint borrowers_org_id_key unique (organization_id, id);
alter table public.loans     add constraint loans_org_id_key     unique (organization_id, id);
alter table public.geofences add constraint geofences_org_id_key unique (organization_id, id);
alter table public.tags      add constraint tags_org_id_key      unique (organization_id, id);
alter table public.animals   add constraint animals_org_id_key   unique (organization_id, id);
alter table public.alerts    add constraint alerts_org_id_key    unique (organization_id, id);

-- Replace the single-column FKs (default names <table>_<column>_fkey).
alter table public.branches        drop constraint if exists branches_region_id_fkey;
alter table public.borrowers       drop constraint if exists borrowers_branch_id_fkey;
alter table public.loans           drop constraint if exists loans_borrower_id_fkey;
alter table public.loans           drop constraint if exists loans_branch_id_fkey;
alter table public.animals         drop constraint if exists animals_tag_id_fkey;
alter table public.animals         drop constraint if exists animals_borrower_id_fkey;
alter table public.animals         drop constraint if exists animals_loan_id_fkey;
alter table public.animals         drop constraint if exists animals_branch_id_fkey;
alter table public.animal_geofence drop constraint if exists animal_geofence_animal_id_fkey;
alter table public.animal_geofence drop constraint if exists animal_geofence_geofence_id_fkey;
alter table public.fixes           drop constraint if exists fixes_tag_id_fkey;
alter table public.fixes           drop constraint if exists fixes_animal_id_fkey;
alter table public.alerts          drop constraint if exists alerts_animal_id_fkey;
alter table public.alerts          drop constraint if exists alerts_tag_id_fkey;
alter table public.alert_events    drop constraint if exists alert_events_alert_id_fkey;

alter table public.branches add constraint branches_region_fk
  foreign key (organization_id, region_id) references public.regions (organization_id, id);

alter table public.borrowers add constraint borrowers_branch_fk
  foreign key (organization_id, branch_id) references public.branches (organization_id, id);

alter table public.loans add constraint loans_borrower_fk
  foreign key (organization_id, borrower_id) references public.borrowers (organization_id, id);
alter table public.loans add constraint loans_branch_fk
  foreign key (organization_id, branch_id) references public.branches (organization_id, id);

alter table public.animals add constraint animals_tag_fk
  foreign key (organization_id, tag_id) references public.tags (organization_id, id);
alter table public.animals add constraint animals_borrower_fk
  foreign key (organization_id, borrower_id) references public.borrowers (organization_id, id);
alter table public.animals add constraint animals_loan_fk
  foreign key (organization_id, loan_id) references public.loans (organization_id, id);
alter table public.animals add constraint animals_branch_fk
  foreign key (organization_id, branch_id) references public.branches (organization_id, id);

alter table public.animal_geofence add constraint animal_geofence_animal_fk
  foreign key (organization_id, animal_id) references public.animals (organization_id, id);
alter table public.animal_geofence add constraint animal_geofence_geofence_fk
  foreign key (organization_id, geofence_id) references public.geofences (organization_id, id);

alter table public.fixes add constraint fixes_tag_fk
  foreign key (organization_id, tag_id) references public.tags (organization_id, id);
alter table public.fixes add constraint fixes_animal_fk
  foreign key (organization_id, animal_id) references public.animals (organization_id, id);

alter table public.alerts add constraint alerts_animal_fk
  foreign key (organization_id, animal_id) references public.animals (organization_id, id);
alter table public.alerts add constraint alerts_tag_fk
  foreign key (organization_id, tag_id) references public.tags (organization_id, id);

alter table public.alert_events add constraint alert_events_alert_fk
  foreign key (organization_id, alert_id) references public.alerts (organization_id, id);

-- ─── 7. users -> profiles + memberships ──────────────────────────────────────
-- Drop the integer user references (and their data), then the table itself.
alter table public.alerts       drop constraint if exists alerts_assignee_id_fkey;
alter table public.alert_events drop constraint if exists alert_events_user_id_fkey;
alter table public.alerts       drop column assignee_id;
alter table public.alert_events drop column user_id;
drop table public.users;
drop type public.user_role;

create table public.memberships (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  role             public.org_role not null,
  region_id        integer,
  branch_id        integer,
  created_at       timestamptz not null default now(),
  -- one membership per user per organization; also the target of the assignee FK
  constraint memberships_org_user_key unique (organization_id, user_id),
  -- scope must match the role: org-wide roles carry no scope, regional managers
  -- one region, branch officers one branch
  constraint memberships_role_scope check (
    (role in ('org_admin', 'auditor') and region_id is null and branch_id is null)
    or (role = 'regional_manager' and region_id is not null and branch_id is null)
    or (role = 'branch_officer' and branch_id is not null)
  ),
  constraint memberships_region_fk
    foreign key (organization_id, region_id) references public.regions (organization_id, id),
  constraint memberships_branch_fk
    foreign key (organization_id, branch_id) references public.branches (organization_id, id)
);
create index memberships_user_idx on public.memberships (user_id);

-- Who an alert is assigned to must be a member of the alert's own organization.
alter table public.alerts add column assignee_id uuid;
alter table public.alerts add constraint alerts_assignee_fk
  foreign key (organization_id, assignee_id)
  references public.memberships (organization_id, user_id)
  on delete set null (assignee_id);

-- The actor of an audit event. Points at the person, not the membership, so the
-- audit trail survives someone being removed from an organization.
alter table public.alert_events add column user_id uuid
  references public.profiles (id) on delete set null;

-- Keep a profile row in step with every new auth user.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for users that already existed before this migration.
insert into public.profiles (id, full_name, phone)
select u.id, nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''), u.phone
from auth.users u
on conflict (id) do nothing;

-- ─── 8. Views and functions, rebuilt with organization_id ────────────────────
create view public.animal_overview with (security_invoker = true) as
select
  a.id,
  a.organization_id,
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

create view public.alert_overview with (security_invoker = true) as
select
  al.id,
  al.organization_id,
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

create view public.alert_audit with (security_invoker = true) as
select
  ae.id,
  ae.organization_id,
  ae.alert_id,
  ae.from_status,
  ae.to_status,
  ae.note,
  ae.created_at,
  ae.user_id,
  p.full_name               as user_name
from public.alert_events ae
left join public.profiles p on p.id = ae.user_id;

create view public.geofence_overview with (security_invoker = true) as
select
  g.id,
  g.organization_id,
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

create view public.geofence_detail with (security_invoker = true) as
select
  g.id,
  g.organization_id,
  g.name,
  g.type,
  g.warning_buffer_m,
  g.district_name,
  g.created_at,
  extensions.st_asgeojson(g.geom)::json as geojson
from public.geofences g;

-- kpi_summary and district_boundary_features are unchanged. kpi_summary stays one
-- aggregate row over whatever the caller may see, so once RLS exists it is
-- automatically per-organization.

-- Animals whose tag has not reported within the threshold and are not yet stale.
create function public.find_offline_animals(p_threshold_hours integer default 6)
returns table (
  organization_id uuid,
  animal_id       integer,
  animal_name     varchar,
  tag_id          integer,
  borrower_name   varchar,
  loan_number     varchar,
  branch_id       integer,
  region_id       integer
)
language sql
stable
set search_path = public, extensions
as $$
  select a.organization_id, a.id, a.name, t.id, b.name, l.loan_number, br.id, r.id
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

-- Create a geofence of any type for an organization and return its id.
-- Error codes (surfaced by PostgREST as error.code):
--   P0002  district not found      22023  missing / invalid input
create function public.create_geofence(
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

  insert into public.geofences (organization_id, name, type, geom, warning_buffer_m, district_name)
  values (p_organization_id, p_name, p_type, v_geom, p_warning_buffer_m, p_district_name)
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── 9. RLS on the new tables (deny-all, no policies yet) and privileges ─────
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.memberships   enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
