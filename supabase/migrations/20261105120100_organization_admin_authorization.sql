-- Approved product decision: organization visibility AND management are active-Admin only.
-- Independent mutation authorization prevents future visibility changes from granting write access.
-- Forward reconciliation of observed hosted drift; never replays or repairs hosted migration history.
begin;
create or replace function public.can_manage_organization() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin') and exists (
    select 1 from auth.users u where u.id = (select auth.uid())
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  );
$$;
alter function public.can_manage_organization() owner to postgres;

create or replace function public.can_read_organizational_structure() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin') and exists (
    select 1 from auth.users u where u.id = (select auth.uid())
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  );
$$;
alter function public.can_read_organizational_structure() owner to postgres;

-- Remove surplus helper grants, including custom/default grants, without cascading dependencies.
do $$ declare item record; helper regprocedure; begin
  if pg_catalog.pg_has_role('anon','postgres','MEMBER') or pg_catalog.pg_has_role('authenticated','postgres','MEMBER') then
    raise exception 'API roles must not be members of the organizational helper owner';
  end if;
  foreach helper in array array['public.can_manage_organization()'::regprocedure,'public.can_read_organizational_structure()'::regprocedure] loop
    for item in select distinct acl.grantee from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      where p.oid=helper and acl.grantee<>p.proowner loop
      execute format('revoke all privileges on function %s from %s',helper,
        case when item.grantee=0 then 'PUBLIC' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(item.grantee)) end);
    end loop;
  end loop;
end $$;
grant execute on function public.can_manage_organization(),public.can_read_organizational_structure() to authenticated;

-- Remove the observed active-user policies and reinstate the approved Admin-only boundary.
-- An additional unknown permissive SELECT policy cannot defeat the restrictive guard.
drop policy if exists "Active users can read divisions" on public.divisions;
drop policy if exists "Organizational structure active user guard" on public.divisions;
drop policy if exists "Admins can read divisions" on public.divisions;
drop policy if exists "Organizational structure admin guard" on public.divisions;
alter table public.divisions enable row level security;
create policy "Admins can read divisions" on public.divisions for select to authenticated
  using ((select public.can_read_organizational_structure()));
create policy "Organizational structure admin guard" on public.divisions as restrictive for select to authenticated
  using ((select public.can_read_organizational_structure()));
revoke all privileges on table public.divisions from public,anon,authenticated;
grant select on public.divisions to authenticated;

-- Restore the minimal organization payload; contact details belong to the existing directory API.
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

notify pgrst,'reload schema';
commit;
