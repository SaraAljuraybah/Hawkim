-- Divisions & Departments 1/4: admin-only management authorization. Reconciled from the
-- feat/divisions-departments migration 20261105120100 (see docs/divisions-departments.md).
--
-- Adds ONE helper, can_manage_organization(): an active Admin (has_role('admin'), so an ended
-- profile is refused) whose Auth account is not deleted or banned. Every management RPC in the
-- following files checks it. It is separate from can_read_organizational_structure(), so a
-- future change to who may READ the chart can never grant write access.
--
-- Correction against the Hawkim-1 original: develop's read side is left exactly as it is.
-- This file does NOT recreate can_read_organizational_structure(), the two divisions SELECT
-- policies, the divisions table grants or get_organizational_structure()
-- (develop: 20261105120000_organizational_structure_for_all_users.sql).

begin;

create or replace function public.can_manage_organization() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin') and exists (
    select 1 from auth.users u where u.id = (select auth.uid())
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  );
$$;
-- CREATE OR REPLACE keeps an existing owner and ACL: never leave this definer helper owned by
-- an API role, and remove any grant other than EXECUTE for authenticated.
alter function public.can_manage_organization() owner to postgres;
do $$
declare item record;
begin
  if pg_catalog.pg_has_role('anon', 'postgres', 'MEMBER')
    or pg_catalog.pg_has_role('authenticated', 'postgres', 'MEMBER') then
    raise exception 'API roles must not be members of the organizational helper owner';
  end if;
  for item in
    select distinct acl.grantee from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
    where p.oid = 'public.can_manage_organization()'::regprocedure and acl.grantee <> p.proowner
  loop
    execute format('revoke all privileges on function public.can_manage_organization() from %s',
      case when item.grantee = 0 then 'PUBLIC' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(item.grantee)) end);
  end loop;
end;
$$;
grant execute on function public.can_manage_organization() to authenticated;

notify pgrst, 'reload schema';
commit;
