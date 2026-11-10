-- Undoes 20261110140000_organizational_structure_emails.sql. Roll the frontend back first, or not at
-- all: the frontend treats a missing division/department email as none and shows "—".
-- get_organizational_structure() returns to its 20261105120000 form (no division/department email)
-- and the organizational_structure_emails() helper is dropped. No data is changed; the column
-- grants on public.divisions and public.departments were never touched.
-- Afterwards: supabase migration repair --status reverted 20261110140000
begin;

create or replace function public.get_organizational_structure() returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not public.can_read_organizational_structure() then
    raise exception 'Only an active user can view organizational structure' using errcode = '42501';
  end if;
  return (
    with roles as (
      select user_id, jsonb_agg(role order by role) as permissions
      from public.user_roles group by user_id
    ), members as (
      select p.department_id, jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'initials', p.initials, 'email', p.email,
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

drop function if exists public.organizational_structure_emails();

commit;
