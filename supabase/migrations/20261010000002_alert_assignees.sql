-- BovineSense — who an alert can be assigned to.
--
-- An alert is assigned to a branch officer of the SAME branch as the animal. The memberships table is
-- readable only by org_admin (user management), so a branch officer could not list colleagues through
-- it. This function answers just that one question, as a security definer with a fixed search_path:
--   * the caller must be a working role (org_admin, regional_manager, branch_officer) of the alert's
--     organization and must be able to see the alert's branch (user_branch_scope);
--   * it returns only the branch officers of that branch: id and name, nothing else.
-- No table is created, so there is no row security to add.

create function public.alert_assignees(p_alert_id integer)
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, coalesce(p.full_name, 'Unnamed user') as full_name
  from public.alerts al
  join public.animals a       on a.id = al.animal_id
  join public.memberships m   on m.organization_id = al.organization_id
                             and m.role = 'branch_officer'
                             and m.branch_id = a.branch_id
  left join public.profiles p on p.id = m.user_id
  where al.id = p_alert_id
    and a.branch_id in (select public.user_branch_scope())
    and public.has_any_role(
          al.organization_id,
          array['org_admin', 'regional_manager', 'branch_officer']::public.org_role[])
  order by 2;
$$;

revoke all on function public.alert_assignees(integer) from public, anon;
grant execute on function public.alert_assignees(integer) to authenticated;
