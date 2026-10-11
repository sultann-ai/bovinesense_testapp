-- BovineSense — background work (pg_cron), data retention and an index review.
--
--   check_offline_tags()        every 15 minutes: marks tags that stopped reporting as offline,
--                               per organization, using that organization's own threshold
--   rollup_and_prune_fixes()    nightly: keeps raw fixes for N days (per organization) and rolls
--                               older ones into fix_daily_summary, one row per animal per day
--   schedule_background_jobs()  (re)creates both pg_cron jobs; safe to run again
--   health_ping() and background_job_status()   what /api/health reads
--
-- Per-organization settings (organizations.settings, all optional; a bad value falls back to the
-- default instead of breaking the job):
--   alert_rules.offline_threshold_hours   default 6   (minimum 1)
--   data_retention.fix_days               default 30  (minimum 7, so a typo cannot wipe history)
--   timezone                              default 'Asia/Karachi' (daily summaries are per local day)
--
-- Every function here is for the service role / pg_cron only, never for app users.

-- ─── Settings helpers ─────────────────────────────────────────────────────────────────────────
create function public.org_offline_threshold_hours(p_org uuid)
returns numeric
language sql stable
set search_path = public
as $$
  select public.alert_rule_number(
    (select o.settings -> 'alert_rules' from public.organizations o where o.id = p_org),
    'offline_threshold_hours', 6, 1);
$$;

create function public.org_retention_days(p_org uuid)
returns integer
language sql stable
set search_path = public
as $$
  select public.alert_rule_number(
    (select o.settings -> 'data_retention' from public.organizations o where o.id = p_org),
    'fix_days', 30, 7)::integer;
$$;

-- A valid IANA zone name from the settings, else the default.
create function public.org_timezone(p_org uuid)
returns text
language sql stable
set search_path = public
as $$
  select coalesce(
    (select z.name::text
     from pg_catalog.pg_timezone_names z
     where z.name = (select o.settings ->> 'timezone' from public.organizations o where o.id = p_org)
     limit 1),
    'Asia/Karachi');
$$;

-- ─── Offline detection ─────────────────────────────────────────────────────────────────────────
-- An animal is offline when its tag has not reported for the organization's threshold. A tag that
-- has never reported counts from when the animal was enrolled, so a new enrolment is not flagged
-- at once. For each such animal: status becomes 'stale', and a 'tag_offline' warning is raised
-- unless one is already open (one open alert at a time). A tag that reports again is brought back
-- by ingest_fix(). Idempotent: an animal already 'stale' is skipped.
--
-- p_org null = every active organization, each judged by its own threshold; one organization's
-- failure is reported as a warning and never stops the others. Returns how many animals went offline.
create function public.check_offline_tags(p_org uuid default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_org       record;
  v_row       record;
  v_threshold numeric;
  v_count     integer := 0;
  v_label     text;
  v_hours     text;
begin
  for v_org in
    select o.id from public.organizations o
    where o.status = 'active' and (p_org is null or o.id = p_org)
    order by o.id
  loop
    begin
      v_threshold := public.org_offline_threshold_hours(v_org.id);
      v_hours := regexp_replace(v_threshold::text, '\.0+$', '');

      for v_row in
        select a.id as animal_id, a.name as animal_name, a.tag_id,
               bo.name as borrower_name, l.loan_number
        from public.animals a
        join      public.tags t       on t.id = a.tag_id and t.organization_id = a.organization_id
        left join public.borrowers bo on bo.id = a.borrower_id
        left join public.loans l      on l.id = a.loan_id
        where a.organization_id = v_org.id
          and a.status <> 'stale'
          and coalesce(t.last_seen_at, a.created_at) < now() - make_interval(secs => (v_threshold * 3600)::double precision)
        order by a.id
        for update of a skip locked
      loop
        update public.animals set status = 'stale' where id = v_row.animal_id;

        if not exists (
          select 1 from public.alerts al
          where al.animal_id = v_row.animal_id and al.type = 'tag_offline' and al.status <> 'resolved'
        ) then
          v_label := coalesce(v_row.animal_name, 'Animal') || ' (' || coalesce(v_row.borrower_name, '') || ')'
                     || case when v_row.loan_number is not null then ' · ' || v_row.loan_number else '' end;
          perform public._raise_alert(
            v_org.id, v_row.animal_id, v_row.tag_id, 'tag_offline', 'warning', 'Tag offline',
            'No fix in ' || v_hours || ' h · ' || v_label);
        end if;
        v_count := v_count + 1;
      end loop;
    exception when others then
      raise warning 'check_offline_tags: organization % failed: %', v_org.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

-- ─── Data retention: raw fixes for N days, then one summary row per animal per day ──────────
create table public.fix_daily_summary (
  organization_id uuid    not null,
  animal_id       integer not null,
  -- The calendar day in the organization's timezone.
  summary_date    date    not null,
  fix_count       integer not null check (fix_count > 0),
  first_fix_at    timestamptz      not null,
  first_lat       double precision not null,
  first_lon       double precision not null,
  last_fix_at     timestamptz      not null,
  last_lat        double precision not null,
  last_lon        double precision not null,
  max_speed_kmh   real,
  constraint fix_daily_summary_pkey primary key (organization_id, animal_id, summary_date),
  constraint fix_daily_summary_animal_fk foreign key (organization_id, animal_id)
    references public.animals (organization_id, id) on delete cascade
);
alter table public.fix_daily_summary enable row level security;

-- Same visibility as the raw fixes: whoever may see the animal may see its history.
create policy fix_daily_summary_select on public.fix_daily_summary
  for select to authenticated
  using (animal_id in (select a.id from public.animals a));

revoke all on public.fix_daily_summary from anon, authenticated;
grant select on public.fix_daily_summary to authenticated;
grant select, insert, update, delete on public.fix_daily_summary to service_role;

-- Rolls fixes older than the organization's retention window into fix_daily_summary and deletes
-- them, one local day at a time, oldest first. Only WHOLE local days past the window are touched,
-- so a summary row is complete. Each day is one statement (delete ... returning feeding the
-- insert), so a day is either fully summarised and removed or left exactly as it was. A late fix
-- for an already-summarised day is merged into that day's row. Fixes with no animal cannot be
-- summarised per animal and are simply removed once past the window.
--
-- p_max_days bounds one run (a large backlog is cleared over several nights). p_now exists for
-- tests. p_org null = every active organization, each with its own retention and timezone.
-- Returns the number of raw fixes removed.
create function public.rollup_and_prune_fixes(
  p_org      uuid default null,
  p_now      timestamptz default now(),
  p_max_days integer default 60
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_org    record;
  v_tz     text;
  v_cutoff timestamptz;
  v_day    date;
  v_n      integer;
  v_total  integer := 0;
begin
  for v_org in
    select o.id from public.organizations o
    where o.status = 'active' and (p_org is null or o.id = p_org)
    order by o.id
  loop
    begin
      v_tz := public.org_timezone(v_org.id);
      -- Start (in the organization's timezone) of the oldest local day that is still kept.
      v_cutoff := (((p_now at time zone v_tz)::date - public.org_retention_days(v_org.id))::timestamp) at time zone v_tz;

      for v_day in
        select distinct (f.fixed_at at time zone v_tz)::date
        from public.fixes f
        where f.organization_id = v_org.id and f.fixed_at < v_cutoff
        order by 1
        limit greatest(p_max_days, 1)
      loop
        with moved as (
          delete from public.fixes f
          where f.organization_id = v_org.id
            and f.fixed_at >= (v_day::timestamp at time zone v_tz)
            and f.fixed_at <  ((v_day + 1)::timestamp at time zone v_tz)
          returning f.id, f.animal_id, f.lat, f.lon, f.fixed_at, f.speed_kmh
        ),
        agg as (
          select m.animal_id,
                 count(*)::integer as n,
                 min(m.fixed_at)   as first_at,
                 max(m.fixed_at)   as last_at,
                 (array_agg(m.lat order by m.fixed_at, m.id))[1]           as first_lat,
                 (array_agg(m.lon order by m.fixed_at, m.id))[1]           as first_lon,
                 (array_agg(m.lat order by m.fixed_at desc, m.id desc))[1] as last_lat,
                 (array_agg(m.lon order by m.fixed_at desc, m.id desc))[1] as last_lon,
                 max(m.speed_kmh)  as max_speed
          from moved m
          where m.animal_id is not null
          group by m.animal_id
        ),
        merged as (
          insert into public.fix_daily_summary as s (
            organization_id, animal_id, summary_date, fix_count,
            first_fix_at, first_lat, first_lon, last_fix_at, last_lat, last_lon, max_speed_kmh)
          select v_org.id, a.animal_id, v_day, a.n,
                 a.first_at, a.first_lat, a.first_lon, a.last_at, a.last_lat, a.last_lon, a.max_speed
          from agg a
          on conflict (organization_id, animal_id, summary_date) do update set
            fix_count     = s.fix_count + excluded.fix_count,
            first_fix_at  = least(s.first_fix_at, excluded.first_fix_at),
            first_lat     = case when excluded.first_fix_at < s.first_fix_at then excluded.first_lat else s.first_lat end,
            first_lon     = case when excluded.first_fix_at < s.first_fix_at then excluded.first_lon else s.first_lon end,
            last_fix_at   = greatest(s.last_fix_at, excluded.last_fix_at),
            last_lat      = case when excluded.last_fix_at > s.last_fix_at then excluded.last_lat else s.last_lat end,
            last_lon      = case when excluded.last_fix_at > s.last_fix_at then excluded.last_lon else s.last_lon end,
            max_speed_kmh = greatest(s.max_speed_kmh, excluded.max_speed_kmh)
          returning 1
        )
        select count(*) into v_n from moved;
        v_total := v_total + v_n;
      end loop;
    exception when others then
      raise warning 'rollup_and_prune_fixes: organization % failed: %', v_org.id, sqlerrm;
    end;
  end loop;
  return v_total;
end;
$$;

-- ─── Index review ────────────────────────────────────────────────────────────────────────────
-- Every query the app and ingest_fix() run on fixes and alerts is scoped to one organization (and
-- Row Level Security adds the same), so organization-leading composites are added:
--   fixes   (organization_id, animal_id, fixed_at desc)   latest fix / trail / previous fix per animal;
--                                                         also the exact column order of the composite
--                                                         foreign key (organization_id, animal_id)
--   alerts  (organization_id, status, created_at desc)    the feed and the open-alert counts
-- Each makes older indexes redundant, which are dropped:
--   fixes_organization_id_idx    strict prefix of the new fixes index
--   fixes_animal_time_idx        (animal_id, fixed_at): its callers (the animal_overview view and
--                                ingest_fix, below) now also filter by organization
--   alerts_organization_id_idx   strict prefix of the new alerts index
--   alerts_status_created_idx    (status, created_at desc): superseded
--
-- MEASURED COST (200,000 fixes, inserted in time order): the two fixes indexes dropped took 48 B per
-- fix (41.5 + 6.6; b-tree deduplication makes the organization-only index tiny); the new composite
-- takes 72 B per fix. So it is about 23 B per fix LARGER than what it replaces (roughly +7% of a
-- fix's total footprint) and, because animal ids are globally unique, the organization prefix does
-- not make any query more selective. The reason to have it is the foreign-key match and one
-- consistent shape. If storage is the binding constraint, the cheaper index is (animal_id,
-- fixed_at) alone; see the README "Index review" for the two statements to switch.
--
-- Kept: fixes_pkey, fixes_tag_time_key (idempotent retransmission and last-seen per tag),
-- alerts_animal_idx (per-animal dedupe), fixes_geom_idx (unused today: a candidate to drop, see README).
-- Added: a BRIN index on fixed_at, practically free (under 1 byte per fix). At 200,000 fixes the
-- planner uses it for both nightly retention queries (find the old days, delete one day) instead of
-- reading the whole table.
-- (Plain CREATE INDEX takes a write lock while it builds: instant at pilot size. On a large live
-- table, create these with CREATE INDEX CONCURRENTLY by hand first.)
create index fixes_org_animal_time_idx on public.fixes (organization_id, animal_id, fixed_at desc);
create index alerts_org_status_created_idx on public.alerts (organization_id, status, created_at desc);
create index fixes_fixed_at_brin on public.fixes using brin (fixed_at);

-- animal_overview: the same view, with the "latest fix" lookup qualified by organization so it
-- uses the new index. (Only that one predicate changed.)
create or replace view public.animal_overview with (security_invoker = true) as
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
  where fx.organization_id = a.organization_id and fx.animal_id = a.id
  order by fx.fixed_at desc
  limit 1
) f on true;

-- ingest_fix: the same function, with every per-animal fixes lookup qualified by organization
-- for the new index. (Only those predicates changed.)
create or replace function public.ingest_fix(
  p_organization_id uuid,
  p_device_key_id   uuid,
  p_tag_serial      text,
  p_lat             double precision,
  p_lon             double precision,
  p_fixed_at        timestamptz,
  p_speed_kmh       double precision default null,
  p_battery_pct     integer default null,
  p_signal_bars     integer default null
)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_rules       record;
  v_tag         record;
  v_animal      record;
  v_fix_id      integer;
  v_prev        record;
  v_prev_out    boolean;
  v_row         record;
  v_speed       double precision;
  v_hours       double precision;
  v_fence       integer;
  v_buffer      integer;
  v_ctx         record;
  v_inside      boolean := true;
  v_out_m       double precision := 0;
  v_edge_m      double precision := null;
  v_consec      integer := 0;
  v_breach      boolean := false;
  v_fast        boolean := false;
  v_prev_status public.animal_status;
  v_new_status  public.animal_status;
  v_label       text;
  v_loan        text;
  v_alerts      jsonb := '[]'::jsonb;
  v_alert_id    integer;
begin
  perform 1
  from public.device_api_keys k
  join public.organizations o on o.id = k.organization_id
  where k.id = p_device_key_id and k.organization_id = p_organization_id
    and k.revoked_at is null and o.status = 'active';
  if not found then
    raise exception 'invalid_key' using errcode = '28000';
  end if;

  select * into v_rules from public.org_alert_rules(p_organization_id);

  -- The tag is resolved inside the key's organization only: another organization's serial is
  -- indistinguishable from an unknown one.
  select t.id, t.is_simulated into v_tag
  from public.tags t
  where t.serial_number = p_tag_serial and t.organization_id = p_organization_id;
  if not found then
    raise exception 'tag_not_found' using errcode = 'P0002';
  end if;

  -- Lock the animal so concurrent fixes for it are applied one after another.
  select a.id, a.status, a.name, a.branch_id, bo.name as borrower_name, l.loan_number, br.region_id
  into v_animal
  from public.animals a
  join      public.branches br  on br.id = a.branch_id
  left join public.borrowers bo on bo.id = a.borrower_id
  left join public.loans l      on l.id = a.loan_id
  where a.tag_id = v_tag.id and a.organization_id = p_organization_id
  order by a.id
  limit 1
  for update of a;
  if not found then
    raise exception 'animal_not_found' using errcode = 'P0002';
  end if;

  -- Store the fix. A retransmission (same tag, same timestamp) changes nothing.
  insert into public.fixes (organization_id, tag_id, animal_id, lat, lon, fixed_at,
                            speed_kmh, battery_pct, signal_bars, is_simulated)
  values (p_organization_id, v_tag.id, v_animal.id, p_lat, p_lon, p_fixed_at,
          p_speed_kmh, p_battery_pct, p_signal_bars, v_tag.is_simulated)
  on conflict (tag_id, fixed_at) do nothing
  returning id into v_fix_id;

  if v_fix_id is null then
    select f.id into v_fix_id from public.fixes f where f.tag_id = v_tag.id and f.fixed_at = p_fixed_at;
    return jsonb_build_object(
      'fix_id', v_fix_id, 'tag_id', v_tag.id, 'animal_id', v_animal.id, 'branch_id', v_animal.branch_id,
      'region_id', v_animal.region_id, 'status', v_animal.status, 'previous_status', v_animal.status,
      'latest', false, 'duplicate', true, 'speed_kmh', null, 'alerts', '[]'::jsonb, 'alerts_raised', 0);
  end if;

  update public.tags
  set last_seen_at = greatest(coalesce(last_seen_at, p_fixed_at), p_fixed_at)
  where id = v_tag.id;

  -- Record device-key usage, at most once a minute (avoids a write per fix).
  update public.device_api_keys
  set last_used_at = now()
  where id = p_device_key_id
    and organization_id = p_organization_id
    and (last_used_at is null or last_used_at < now() - interval '1 minute');

  -- Only the animal's newest fix may change its state. A late, out-of-order fix is just history.
  if exists (
    select 1 from public.fixes f
    where f.organization_id = p_organization_id and f.animal_id = v_animal.id and (f.fixed_at, f.id) > (p_fixed_at, v_fix_id)
  ) then
    return jsonb_build_object(
      'fix_id', v_fix_id, 'tag_id', v_tag.id, 'animal_id', v_animal.id, 'branch_id', v_animal.branch_id,
      'region_id', v_animal.region_id, 'status', v_animal.status, 'previous_status', v_animal.status,
      'latest', false, 'duplicate', false, 'speed_kmh', null, 'alerts', '[]'::jsonb, 'alerts_raised', 0);
  end if;

  v_prev_status := v_animal.status;
  v_label := coalesce(v_animal.name, 'Animal') || ' (' || coalesce(v_animal.borrower_name, '') || ')';
  v_loan  := case when v_animal.loan_number is not null then ' · ' || v_animal.loan_number else '' end;

  -- The fix just before this one, for speed and for the consecutive-fix count.
  select f.lat, f.lon, f.fixed_at into v_prev
  from public.fixes f
  where f.organization_id = p_organization_id and f.animal_id = v_animal.id and (f.fixed_at, f.id) < (p_fixed_at, v_fix_id)
  order by f.fixed_at desc, f.id desc
  limit 1;

  -- Speed: as reported by the tag, otherwise computed from the previous fix.
  v_speed := p_speed_kmh;
  if v_speed is null and v_prev.fixed_at is not null then
    v_hours := extract(epoch from (p_fixed_at - v_prev.fixed_at)) / 3600.0;
    v_speed := case when v_hours <= 0 then 0
                    else public.haversine_km(v_prev.lat, v_prev.lon, p_lat, p_lon) / v_hours end;
  end if;
  v_fast := v_speed is not null and v_speed > v_rules.speed_threshold_kmh;

  -- Where the animal is relative to its active fence.
  select ag.geofence_id, g.warning_buffer_m into v_fence, v_buffer
  from public.animal_geofence ag
  join public.geofences g on g.id = ag.geofence_id and g.organization_id = p_organization_id
  where ag.animal_id = v_animal.id and ag.is_active
  limit 1;

  if v_fence is not null then
    select s.* into v_ctx from public.fence_spatial_context(v_fence, p_lon, p_lat) s;
    if v_ctx.inside_fence is not null then
      v_inside := v_ctx.inside_fence;
      v_out_m  := case when v_inside then 0 else v_ctx.metres_outside end;
      v_edge_m := v_ctx.metres_to_edge;

      -- Consecutive fixes outside: this one plus the fixes immediately before it, as many as the
      -- rule needs, stopping at the first one that was inside.
      if not v_inside then
        v_consec := 1;
        if v_rules.breach_consecutive_fixes > 1 then
          for v_row in
            select f.lat, f.lon from public.fixes f
            where f.organization_id = p_organization_id and f.animal_id = v_animal.id and (f.fixed_at, f.id) < (p_fixed_at, v_fix_id)
            order by f.fixed_at desc, f.id desc
            limit v_rules.breach_consecutive_fixes - 1
          loop
            select not s.inside_fence into v_prev_out from public.fence_spatial_context(v_fence, v_row.lon, v_row.lat) s;
            exit when v_prev_out is distinct from true;
            v_consec := v_consec + 1;
          end loop;
        end if;
        v_breach := v_consec >= v_rules.breach_consecutive_fixes or v_out_m >= v_rules.hard_breach_metres;
      end if;
    else
      v_fence := null;  -- fence has no geometry: treat as unfenced
    end if;
  end if;

  if v_fence is not null then
    -- Breach: confirmed outside. Raised on entering the breach state, never repeated.
    if v_breach and v_prev_status <> 'breach' then
      v_alert_id := public._raise_alert(
        p_organization_id, v_animal.id, v_tag.id, 'breach', 'critical', 'Left district boundary',
        to_char(round((v_out_m / 1000.0)::numeric, 2), 'FM999990.00') || ' km outside boundary · ' || v_label || v_loan,
        (v_out_m / 1000.0)::real);
      v_alerts := v_alerts || jsonb_build_object('id', v_alert_id, 'type', 'breach', 'severity', 'critical');
    end if;

    -- Near boundary, outside but not yet a breach (a single noisy fix).
    if not v_inside and not v_breach and v_prev_status not in ('near', 'breach') then
      v_alert_id := public._raise_alert(
        p_organization_id, v_animal.id, v_tag.id, 'near_boundary', 'warning', 'Near district boundary',
        round(v_out_m::numeric, 0)::text || ' m outside boundary · ' || v_label,
        (v_out_m / 1000.0)::real);
      v_alerts := v_alerts || jsonb_build_object('id', v_alert_id, 'type', 'near_boundary', 'severity', 'warning');
    end if;

    -- Near boundary, inside but within the warning buffer.
    if v_inside and v_edge_m < v_buffer and v_prev_status not in ('near', 'breach') then
      v_alert_id := public._raise_alert(
        p_organization_id, v_animal.id, v_tag.id, 'near_boundary', 'warning', 'Approaching district boundary',
        round(v_edge_m::numeric, 0)::text || ' m from boundary inside fence · ' || v_label);
      v_alerts := v_alerts || jsonb_build_object('id', v_alert_id, 'type', 'near_boundary', 'severity', 'warning');
    end if;

    -- Returned: was in breach, now inside. Informational: the breach stays open for a human.
    if v_prev_status = 'breach' and v_inside then
      v_alert_id := public._raise_alert(
        p_organization_id, v_animal.id, v_tag.id, 'returned', 'info', 'Returned to boundary',
        'Animal back inside geofence — open breach alert must still be resolved manually · ' || v_label);
      v_alerts := v_alerts || jsonb_build_object('id', v_alert_id, 'type', 'returned', 'severity', 'info');
    end if;
  end if;

  -- Fast movement: speed strictly above the threshold. One open alert at a time.
  if v_fast and not exists (
    select 1 from public.alerts al
    where al.animal_id = v_animal.id and al.type = 'fast_movement' and al.status <> 'resolved'
  ) then
    v_alert_id := public._raise_alert(
      p_organization_id, v_animal.id, v_tag.id, 'fast_movement', 'critical', 'Fast movement detected',
      round(v_speed::numeric, 0)::text || ' km/h — possible vehicle transport · ' || v_label || v_loan);
    v_alerts := v_alerts || jsonb_build_object('id', v_alert_id, 'type', 'fast_movement', 'severity', 'critical');
  end if;

  -- Low battery: strictly below the threshold. One open alert at a time.
  if p_battery_pct is not null and p_battery_pct < v_rules.low_battery_pct and not exists (
    select 1 from public.alerts al
    where al.animal_id = v_animal.id and al.type = 'low_battery' and al.status <> 'resolved'
  ) then
    v_alert_id := public._raise_alert(
      p_organization_id, v_animal.id, v_tag.id, 'low_battery', 'info', 'Low battery',
      'Battery at ' || p_battery_pct || '% · ' || v_label);
    v_alerts := v_alerts || jsonb_build_object('id', v_alert_id, 'type', 'low_battery', 'severity', 'info');
  end if;

  -- The animal's new status.
  if v_fence is null then
    v_new_status := case
      when v_fast then 'fast'
      when v_prev_status in ('stale', 'fast') then 'inside'
      else v_prev_status end;
  elsif v_prev_status = 'breach' then
    v_new_status := case when v_inside then 'inside' else 'breach' end;
  elsif not v_inside then
    v_new_status := case when v_breach then 'breach' else 'near' end;
  elsif v_edge_m < v_buffer then
    v_new_status := 'near';
  elsif v_fast then
    v_new_status := 'fast';
  else
    v_new_status := 'inside';
  end if;

  if v_new_status <> v_prev_status then
    update public.animals set status = v_new_status where id = v_animal.id;
  end if;

  return jsonb_build_object(
    'fix_id', v_fix_id, 'tag_id', v_tag.id, 'animal_id', v_animal.id, 'branch_id', v_animal.branch_id,
    'region_id', v_animal.region_id, 'status', v_new_status, 'previous_status', v_prev_status,
    'latest', true, 'duplicate', false, 'speed_kmh', v_speed,
    'alerts', v_alerts, 'alerts_raised', jsonb_array_length(v_alerts));
end;
$$;

drop index public.fixes_organization_id_idx;
drop index public.fixes_animal_time_idx;
drop index public.alerts_organization_id_idx;
drop index public.alerts_status_created_idx;

-- ─── Scheduling (pg_cron) ──────────────────────────────────────────────────────────────────────
-- Both jobs are scheduled by name, so running this again replaces them instead of duplicating.
-- pg_cron runs on UTC: 22:00 UTC is 03:00 in Pakistan.
create function public.schedule_background_jobs()
returns void
language plpgsql
set search_path = public
as $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron is not available: enable it under Database -> Extensions, then run select public.schedule_background_jobs();'
      using errcode = '0A000';
  end if;
  perform cron.schedule('bovinesense-check-offline-tags', '*/15 * * * *', 'select public.check_offline_tags()');
  perform cron.schedule('bovinesense-fix-retention', '0 22 * * *', 'select public.rollup_and_prune_fixes()');
end;
$$;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'could not enable pg_cron (%): enable it under Database -> Extensions', sqlerrm;
  end;

  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron is not available: background jobs are NOT scheduled; run select public.schedule_background_jobs(); once it is enabled';
  else
    perform public.schedule_background_jobs();
  end if;
end $$;

-- ─── Health ───────────────────────────────────────────────────────────────────────────────────
create function public.health_ping()
returns jsonb
language sql stable
as $$
  select jsonb_build_object('ok', true, 'server_time', now());
$$;

-- The last run of each BovineSense job, as pg_cron recorded it. SECURITY DEFINER because the cron
-- schema is not readable by the API roles; returns nothing at all if pg_cron is not installed.
create function public.background_job_status()
returns table (job_name text, schedule text, last_run_at timestamptz, last_status text)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return;
  end if;
  return query execute $q$
    select j.jobname::text, j.schedule::text, d.start_time, d.status::text
    from cron.job j
    left join lateral (
      select r.start_time, r.status
      from cron.job_run_details r
      where r.jobid = j.jobid
      order by r.start_time desc
      limit 1
    ) d on true
    where j.jobname like 'bovinesense-%'
    order by j.jobname
  $q$;
end;
$$;

-- ─── Privileges: service role / pg_cron only ───────────────────────────────────────────────────
revoke execute on function
  public.org_offline_threshold_hours(uuid),
  public.org_retention_days(uuid),
  public.org_timezone(uuid),
  public.check_offline_tags(uuid),
  public.rollup_and_prune_fixes(uuid, timestamptz, integer),
  public.schedule_background_jobs(),
  public.health_ping(),
  public.background_job_status()
from public, anon, authenticated;

grant execute on function
  public.org_offline_threshold_hours(uuid),
  public.org_retention_days(uuid),
  public.org_timezone(uuid),
  public.check_offline_tags(uuid),
  public.rollup_and_prune_fixes(uuid, timestamptz, integer),
  public.schedule_background_jobs(),
  public.health_ping(),
  public.background_job_status()
to service_role;
