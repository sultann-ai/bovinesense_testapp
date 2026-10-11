-- BovineSense — the Devices screen: one row per tag, with its latest battery and signal.
--
-- A view with security_invoker, so it shows exactly the tags the caller's Row Level Security lets them
-- read (whole-organization readers see every tag, including unassigned ones; a regional manager or
-- branch officer sees the tags of the animals in their scope). "Unassigned" is a tag that no animal
-- carries. No table is created, so there is no new row security to add.

create view public.device_overview with (security_invoker = true) as
select
  t.id,
  t.organization_id,
  t.serial_number,
  t.is_simulated,
  t.last_seen_at,
  a.id                  as animal_id,
  a.name                as animal_name,
  (a.id is null)        as is_unassigned,
  f.battery_pct,
  f.signal_bars,
  f.fixed_at            as last_fix_at
from public.tags t
left join public.animals a on a.tag_id = t.id
left join lateral (
  select fx.battery_pct, fx.signal_bars, fx.fixed_at
  from public.fixes fx
  where fx.tag_id = t.id
  order by fx.fixed_at desc
  limit 1
) f on true;

grant select on public.device_overview to authenticated;
