-- BovineSense — authentication support.
--
--   * platform_admins    BovineSense staff with cross-tenant access. Deliberately a
--                        separate table, never an organization membership.
--   * platform_audit_log every time a platform admin opens an organization they are
--                        not a member of (project rule: cross-tenant access is audited).
--   * kpi_summary        now one row per organization / region / branch so the API can
--                        scope it to what the signed-in user may see. The percentage is
--                        computed by the caller after summing, because percentages
--                        cannot be summed.
--
-- Still NOT here: RLS policies. Both new tables get RLS enabled with no policies and no
-- grants for anon/authenticated; the server reads them with the service-role client.

create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.platform_audit_log (
  id               bigint generated always as identity primary key,
  user_id          uuid references auth.users (id) on delete set null,
  organization_id  uuid references public.organizations (id) on delete set null,
  action           text not null,
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index platform_audit_log_org_idx  on public.platform_audit_log (organization_id, created_at desc);
create index platform_audit_log_user_idx on public.platform_audit_log (user_id, created_at desc);

alter table public.platform_admins    enable row level security;
alter table public.platform_audit_log enable row level security;

-- Column set changes, so the view is dropped and recreated.
drop view if exists public.kpi_summary;

create view public.kpi_summary with (security_invoker = true) as
with animal_counts as (
  select
    a.organization_id,
    br.region_id,
    a.branch_id,
    count(*)                                        as total,
    count(*) filter (where a.status = 'inside')     as inside_count,
    count(*) filter (where a.status = 'breach')     as breach_count,
    count(*) filter (where a.status = 'stale')      as stale_count
  from public.animals a
  join public.branches br on br.id = a.branch_id
  group by a.organization_id, br.region_id, a.branch_id
),
alert_counts as (
  select
    a.organization_id,
    br.region_id,
    a.branch_id,
    count(*) as new_alerts
  from public.alerts al
  join public.animals a   on a.id = al.animal_id
  join public.branches br on br.id = a.branch_id
  where al.status in ('new', 'acknowledged')
  group by a.organization_id, br.region_id, a.branch_id
)
select
  ac.organization_id,
  ac.region_id,
  ac.branch_id,
  ac.total::integer                       as total,
  ac.inside_count::integer                as inside_count,
  ac.breach_count::integer                as breach_count,
  ac.stale_count::integer                 as stale_count,
  coalesce(alc.new_alerts, 0)::integer    as new_alerts
from animal_counts ac
left join alert_counts alc
  on  alc.organization_id = ac.organization_id
  and alc.region_id       = ac.region_id
  and alc.branch_id       = ac.branch_id;

-- Same privilege posture as every other migration.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
