-- BovineSense — multi-tenant ingestion: device keys and the alert rules, in the database.
--
--   * device_api_keys   one or more keys per organization for tags / gateways. Only a SHA-256
--                       hash is stored; the plain key is shown once, when it is created.
--   * org_alert_rules() the alert thresholds, per organization, with the original defaults:
--                       organizations.settings -> 'alert_rules' -> { hard_breach_metres: 200,
--                       breach_consecutive_fixes: 2, speed_threshold_kmh: 15, low_battery_pct: 20 }
--                       (the warning buffer, default 500 m, is a property of each fence).
--   * ingest_fix()      inserts a fix and runs every rule in ONE transaction. The rules used to
--                       live in TypeScript (src/lib/alerts); they now run where the data is.
--
-- Rule semantics follow docs/ARCHITECTURE.md, with the defects found in the audit fixed rather than
-- ported:
--   * "2 consecutive fixes outside" means the immediately preceding fixes, not any earlier one;
--   * fast-movement and low-battery alerts are raised once, not on every fix, until resolved;
--   * a near-boundary alert is raised on entering the buffer from any state except near/breach;
--   * an animal without a fence still updates last_seen and gets the speed / battery rules;
--   * a fix older than the animal's newest fix is stored but does not change status or raise alerts;
--   * a retransmitted fix (same tag and timestamp) is accepted once, idempotently.

-- ─── Device keys ────────────────────────────────────────────────────────────────────────────
create table public.device_api_keys (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  key_hash         text not null,
  -- First characters of the key, so an admin can tell keys apart in a list. Not a secret.
  key_prefix       text not null,
  label            text not null,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  constraint device_api_keys_hash_key unique (key_hash),
  constraint device_api_keys_hash_format check (key_hash ~ '^[0-9a-f]{64}$'),
  constraint device_api_keys_label_not_blank check (btrim(label) <> '')
);
create index device_api_keys_org_idx on public.device_api_keys (organization_id);
alter table public.device_api_keys enable row level security;

-- Org admins manage their organization's keys. The hash column is never granted to API roles.
create policy device_api_keys_select on public.device_api_keys
  for select to authenticated
  using (public.has_role(organization_id, 'org_admin') or public.is_platform_admin());
create policy device_api_keys_insert on public.device_api_keys
  for insert to authenticated
  with check (public.has_role(organization_id, 'org_admin') and created_by = (select auth.uid()));
-- The only change a user may make is to revoke a key (and it cannot be un-revoked).
create policy device_api_keys_update on public.device_api_keys
  for update to authenticated
  using (public.has_role(organization_id, 'org_admin'))
  with check (public.has_role(organization_id, 'org_admin') and revoked_at is not null);

revoke all on public.device_api_keys from anon, authenticated;
grant select (id, organization_id, key_prefix, label, created_at, created_by, last_used_at, revoked_at)
  on public.device_api_keys to authenticated;
grant insert (organization_id, key_hash, key_prefix, label, created_by)
  on public.device_api_keys to authenticated;
grant update (revoked_at) on public.device_api_keys to authenticated;
grant select, insert, update, delete on public.device_api_keys to service_role;

-- ─── Retransmitted fixes are idempotent ────────────────────────────────────────────────────────
-- (A tag that repeats a reading must not create a second row.) Exact duplicates are removed first.
delete from public.fixes a
using public.fixes b
where a.tag_id = b.tag_id and a.fixed_at = b.fixed_at and a.id > b.id;

drop index if exists public.fixes_tag_time_idx;
create unique index fixes_tag_time_key on public.fixes (tag_id, fixed_at);

-- ─── Per-organization rule settings ────────────────────────────────────────────────────────────
-- A number from the settings JSON when it is a valid number >= p_min, else the default. A typo in
-- settings (a string, a negative) must never stop ingestion, so it falls back to the default.
create function public.alert_rule_number(
  p_rules jsonb, p_key text, p_default numeric, p_min numeric
)
returns numeric
language sql immutable
as $$
  -- Nested CASE: SQL does not promise to evaluate AND operands left to right, and a string must
  -- never reach the numeric cast.
  select case
    when jsonb_typeof(p_rules -> p_key) = 'number' then
      case when (p_rules ->> p_key)::numeric >= p_min then (p_rules ->> p_key)::numeric else p_default end
    else p_default
  end;
$$;

create function public.org_alert_rules(p_org uuid)
returns table (
  hard_breach_metres       numeric,
  breach_consecutive_fixes integer,
  speed_threshold_kmh      numeric,
  low_battery_pct          numeric
)
language sql stable
set search_path = public
as $$
  select
    public.alert_rule_number(r.rules, 'hard_breach_metres', 200, 0),
    public.alert_rule_number(r.rules, 'breach_consecutive_fixes', 2, 1)::integer,
    public.alert_rule_number(r.rules, 'speed_threshold_kmh', 15, 0),
    public.alert_rule_number(r.rules, 'low_battery_pct', 20, 0)
  from (
    select (select o.settings -> 'alert_rules' from public.organizations o where o.id = p_org) as rules
  ) r;
$$;

-- Great-circle distance in kilometres (same formula and Earth radius as the old TypeScript).
create function public.haversine_km(
  lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision
)
returns double precision
language sql immutable
as $$
  select 2 * 6371 * atan2(sqrt(a), sqrt(1 - a))
  from (
    select power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2) as a
  ) t;
$$;

-- ─── Raising an alert (internal) ────────────────────────────────────────────────────────────
create function public._raise_alert(
  p_org uuid, p_animal integer, p_tag integer,
  p_type public.alert_type, p_severity public.alert_severity,
  p_title text, p_detail text, p_distance_km real default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_id integer;
begin
  insert into public.alerts (organization_id, animal_id, tag_id, type, severity, status, title, detail, distance_km)
  values (p_org, p_animal, p_tag, p_type, p_severity, 'new', p_title, p_detail, p_distance_km)
  returning id into v_id;

  -- System-created audit entry (no user).
  insert into public.alert_events (organization_id, alert_id, from_status, to_status)
  values (p_org, v_id, null, 'new');

  return v_id;
end;
$$;

-- ─── ingest_fix ──────────────────────────────────────────────────────────────────────────────
-- Called by the ingestion route with the service role after it has authenticated the device key
-- (so p_organization_id comes from the key, never from the request body).
--
-- Errors (the message says which):
--   invalid_key        SQLSTATE 28000: the key is revoked or not this organization's, or the
--                      organization is suspended (the route has already checked; this closes the gap
--                      between that check and this call)
--   tag_not_found      SQLSTATE P0002: no tag with that serial in THIS organization
--   animal_not_found   SQLSTATE P0002: the tag is not assigned to an animal
--
-- Returns jsonb: { fix_id, tag_id, animal_id, branch_id, region_id, status, previous_status, latest,
--                  duplicate, speed_kmh, alerts: [{id, type, severity}], alerts_raised }
create function public.ingest_fix(
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
    where f.animal_id = v_animal.id and (f.fixed_at, f.id) > (p_fixed_at, v_fix_id)
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
  where f.animal_id = v_animal.id and (f.fixed_at, f.id) < (p_fixed_at, v_fix_id)
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
            where f.animal_id = v_animal.id and (f.fixed_at, f.id) < (p_fixed_at, v_fix_id)
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

-- ─── Privileges: system functions are for the service role only ─────────────────────────────
-- (Explicit, per function: a blanket revoke would also strip the grants from migration 5.)
revoke execute on function
  public.alert_rule_number(jsonb, text, numeric, numeric),
  public.org_alert_rules(uuid),
  public.haversine_km(double precision, double precision, double precision, double precision),
  public._raise_alert(uuid, integer, integer, public.alert_type, public.alert_severity, text, text, real),
  public.ingest_fix(uuid, uuid, text, double precision, double precision, timestamptz,
                    double precision, integer, integer)
from public, anon, authenticated;

grant execute on function
  public.alert_rule_number(jsonb, text, numeric, numeric),
  public.org_alert_rules(uuid),
  public.haversine_km(double precision, double precision, double precision, double precision),
  public._raise_alert(uuid, integer, integer, public.alert_type, public.alert_severity, text, text, real),
  public.ingest_fix(uuid, uuid, text, double precision, double precision, timestamptz,
                    double precision, integer, integer)
to service_role;
