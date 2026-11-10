-- Organizational Structure: every active user sees division and department emails.
--
-- Before: get_organizational_structure() returned divisions as {id, name} and departments as
-- {id, name, divisionId, employees}. The email columns on public.divisions (20261107120100) and
-- public.departments (20261108150000) are withheld from `authenticated` by column grants; only
-- admins read them, through get_divisions_departments().
-- After: each division and department in get_organizational_structure() also carries `email`
-- (null when none).
--
--  * The column grants on public.divisions and public.departments are NOT changed: nobody can
--    `select email from public.divisions/departments` directly that couldn't before.
--  * get_organizational_structure() stays SECURITY INVOKER (tests/organizational_structure.sql
--    asserts it), so every other field still goes through the caller's RLS. It reads the emails
--    from one new SECURITY DEFINER helper, organizational_structure_emails(), which returns only
--    id + email of active divisions and non-removed departments (the same rows the structure
--    shows), and only to a caller allowed to read the structure (can_read_organizational_structure()).
--  * The rest of the function body is the 20261105120000 one, unchanged.
--
-- Run as one transaction. Undo: supabase/scripts/rollback_organizational_structure_emails.sql

begin;

create or replace function public.organizational_structure_emails()
returns table(kind text, id text, email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.can_read_organizational_structure() then
    raise exception 'Only an active user can view organizational structure' using errcode = '42501';
  end if;
  return query
    select 'division'::text, v.id, v.email from public.divisions v where v.is_active is not false
    union all
    select 'department'::text, d.id, d.email from public.departments d where d.removed_at is null;
end;
$$;
revoke all on function public.organizational_structure_emails() from public, anon, authenticated;
grant execute on function public.organizational_structure_emails() to authenticated;

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
    ), emails as (
      select e.kind, e.id, e.email from public.organizational_structure_emails() e
    )
    select jsonb_build_object(
      'organization', null,
      'divisions', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'email', e.email) order by v.name, v.id), '[]'::jsonb)
        from public.divisions v left join emails e on e.kind = 'division' and e.id = v.id
        where v.is_active is not false),
      'departments', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'divisionId', d.division_id, 'email', e.email,
        'employees', coalesce(m.employees, '[]'::jsonb)
      ) order by d.name, d.id), '[]'::jsonb)
      from public.departments d left join members m on m.department_id = d.id
        left join emails e on e.kind = 'department' and e.id = d.id
      where d.removed_at is null)
    )
  );
end;
$$;
revoke all on function public.get_organizational_structure() from public, anon, authenticated;
grant execute on function public.get_organizational_structure() to authenticated;

commit;
