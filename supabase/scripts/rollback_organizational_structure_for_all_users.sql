-- Undoes 20261105120000_organizational_structure_for_all_users.sql. Only if something goes wrong
-- after applying it. Run it yourself in the Supabase SQL Editor (it is not a migration), and only
-- AFTER the app is back on the code from before this change: the new app requires each
-- employee's email and would show "could not be loaded" without it.
--
-- It restores the Admin-only helper, the two original policies (dropped and recreated with their
-- original names and condition), and the function without email. No row changes. The migration
-- stays recorded as applied, so a later fix goes in as a new migration.

begin;

create or replace function public.can_read_organizational_structure() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role('admin') and exists (
    select 1 from auth.users u where u.id = (select auth.uid())
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  );
$$;

drop policy if exists "Active users can read divisions" on public.divisions;
drop policy if exists "Organizational structure active user guard" on public.divisions;
drop policy if exists "Admins can read divisions" on public.divisions;
drop policy if exists "Organizational structure admin guard" on public.divisions;
create policy "Admins can read divisions" on public.divisions for select to authenticated
  using ((select public.can_read_organizational_structure()));
create policy "Organizational structure admin guard" on public.divisions as restrictive for select to authenticated
  using ((select public.can_read_organizational_structure()));

create or replace function public.get_organizational_structure() returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not public.can_read_organizational_structure() then
    raise exception 'Only an active admin can view organizational structure' using errcode = '42501';
  end if;
  return (
    with roles as (
      select user_id, jsonb_agg(role order by role) as permissions
      from public.user_roles group by user_id
    ), members as (
      select p.department_id, jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'initials', p.initials,
        'position', p.position, 'permissions', coalesce(r.permissions, '[]'::jsonb)
      ) order by p.full_name, p.id) as employees
      from public.profiles p left join roles r on r.user_id = p.id
      where p.deleted_at is null group by p.department_id
    )
    select jsonb_build_object(
      'organization', null,
      'divisions', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id), '[]'::jsonb)
        from public.divisions where is_active is not false),
      'departments', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'divisionId', d.division_id,
        'employees', coalesce(m.employees, '[]'::jsonb)
      ) order by d.name, d.id), '[]'::jsonb)
      from public.departments d left join members m on m.department_id = d.id
      where d.removed_at is null)
    )
  );
end;
$$;
revoke all on function public.get_organizational_structure() from public, anon, authenticated;
grant execute on function public.get_organizational_structure() to authenticated;

commit;
