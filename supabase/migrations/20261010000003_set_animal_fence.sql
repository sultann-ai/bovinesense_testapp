-- BovineSense — assign animals to a geofence (and take them off it).
--
-- An animal has at most one ACTIVE fence (unique index animal_geofence_one_active_idx). Assigning an
-- animal to a fence therefore first retires its current assignment, then adds the new one. Unassigning
-- retires the assignment and leaves the history row behind.
--
-- This is SECURITY INVOKER on purpose: it runs as the signed-in user, so Row Level Security decides who
-- may do it (animal_geofence insert/update are org_admin only) and which animals and fences are even
-- visible. Animals of another organization are never matched, because the fence's own organization is
-- the only one used. No table is created, so there is no new row security to add.
--
-- Returns how many animals were changed.

create function public.set_animal_fence(
  p_geofence_id integer,
  p_animal_ids  integer[],
  p_assign      boolean
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org     uuid;
  v_changed integer := 0;
begin
  select g.organization_id into v_org from public.geofences g where g.id = p_geofence_id;
  if v_org is null then
    raise exception 'geofence % not found', p_geofence_id using errcode = 'P0002';
  end if;

  if p_assign then
    -- Retire the current assignment of each animal that is not already on this fence.
    update public.animal_geofence ag
       set is_active = false
     where ag.organization_id = v_org
       and ag.is_active
       and ag.animal_id = any (p_animal_ids)
       and ag.geofence_id <> p_geofence_id;

    insert into public.animal_geofence (organization_id, animal_id, geofence_id, is_active)
    select v_org, a.id, p_geofence_id, true
      from public.animals a
     where a.organization_id = v_org
       and a.id = any (p_animal_ids)
       and not exists (
         select 1 from public.animal_geofence ag
          where ag.animal_id = a.id and ag.geofence_id = p_geofence_id and ag.is_active
       );
    get diagnostics v_changed = row_count;
  else
    update public.animal_geofence ag
       set is_active = false
     where ag.organization_id = v_org
       and ag.is_active
       and ag.geofence_id = p_geofence_id
       and ag.animal_id = any (p_animal_ids);
    get diagnostics v_changed = row_count;
  end if;

  return v_changed;
end;
$$;

revoke all on function public.set_animal_fence(integer, integer[], boolean) from public, anon;
grant execute on function public.set_animal_fence(integer, integer[], boolean) to authenticated;
