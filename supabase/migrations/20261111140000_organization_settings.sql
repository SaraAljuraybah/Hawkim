-- The organization's name, shown at the top of Divisions and Departments.
--
-- Hawkim is single-tenant (one organization per deployment), so the name is one row: the primary key
-- of public.organization_settings can only be true, the same pattern as public.super_admin. Additive
-- only: one new table and two new functions; no existing object or row is changed. The table starts
-- empty (nothing is copied from access requests): until the Super Admin saves a name there is none.
--
-- Rules enforced here (never only in the browser):
-- - Reading: any signed-in person with an active profile, through get_organization_name().
-- - Changing: only the current Super Admin (is_super_admin()), through set_organization_name().
-- - The name is trimmed, 1 to 200 characters (as on Request Hawkim) and on one line (no control characters).
-- - The table itself has RLS on, no policies and no grants: nobody reads or writes it directly.

begin;

create table public.organization_settings (
  singleton boolean primary key default true check (singleton),
  name text not null check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 200 and name !~ '[[:cntrl:]]'
  ),
  updated_at timestamptz not null default now(),
  -- Who saved the current name (null once that profile is removed).
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.organization_settings enable row level security;
-- No policies and no grants: read through get_organization_name(), changed only by set_organization_name().
revoke all on table public.organization_settings from public, anon, authenticated, service_role;

-- The organization's name, or null when none is saved yet, or for a caller without an active profile.
create function public.get_organization_name() returns text
language sql stable security definer set search_path = '' as $$
  select o.name from public.organization_settings o
  where o.singleton
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.deleted_at is null);
$$;

-- Saves the organization's name (trimmed) and returns it. Only the Super Admin.
create function public.set_organization_name(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can change the organization name'
      using errcode = '42501', hint = 'super-admin-required';
  end if;
  if pg_catalog.char_length(v_name) not between 1 and 200 or v_name ~ '[[:cntrl:]]' then
    raise exception 'The organization name must be 1 to 200 characters on one line'
      using errcode = '22023', hint = 'invalid';
  end if;
  insert into public.organization_settings (singleton, name, updated_at, updated_by)
  values (true, v_name, pg_catalog.now(), (select auth.uid()))
  on conflict (singleton) do update
    set name = excluded.name, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return v_name;
end;
$$;

alter table public.organization_settings owner to postgres;
alter function public.get_organization_name() owner to postgres;
alter function public.set_organization_name(text) owner to postgres;

revoke all on function public.get_organization_name(), public.set_organization_name(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_organization_name(), public.set_organization_name(text) to authenticated;

commit;
