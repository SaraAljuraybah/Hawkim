-- Optional real divisions. Existing departments remain unassigned; no records are invented.
create table public.divisions (
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 1 and 100)
);
alter table public.departments add column division_id text references public.divisions(id) on delete set null;
create index departments_division on public.departments(division_id);
alter table public.divisions enable row level security;
create policy "Admins can read divisions" on public.divisions for select to authenticated
using ((select public.has_role('admin')));
revoke all on public.divisions from anon, authenticated;
grant select on public.divisions to authenticated;

-- Uses the existing profile, home-department FK and role records. No contact details.
-- Invoker security retains RLS as well as the explicit Admin check.
create function public.get_organizational_structure() returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not public.has_role('admin') then
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
      -- There is currently no persisted organization profile in Hawkim.
      'organization', null,
      'divisions', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name, id), '[]'::jsonb) from public.divisions),
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
revoke execute on function public.get_organizational_structure() from public, anon;
grant execute on function public.get_organizational_structure() to authenticated;
