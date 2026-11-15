-- Each staff member's phone number in the Organizational Structure data, for the Staff Profile Preview.
--
-- The preview (opened from a name on Organizational Structure and Review Requests) now shows the phone
-- number from the person's profile (profiles.phone, +9665XXXXXXXX, or null). This makes colleagues' phone
-- numbers visible to every active user of the same organization, as decided for this change. Every active
-- user could already read profiles.phone (the column grant and the same-organization row policy); the
-- function still runs as the caller (security invoker), so those rules decide what it returns.
--
-- Only 'phone' is added to each employee; the body is otherwise that of
-- 20261110140000_organizational_structure_emails.sql, and the grants are unchanged.

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
        'phone', p.phone, 'position', p.position, 'permissions', coalesce(r.permissions, '[]'::jsonb)
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
