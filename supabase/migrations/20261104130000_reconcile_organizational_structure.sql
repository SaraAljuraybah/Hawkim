-- Reconciles fresh, original-prototype and manually initialized organizations.
-- No organization records, assignments or migration-ledger entries are written.
-- The untracked original 20261104120000 draft is archived in proposals/ because
-- that version belongs to the tracked update_sop_description migration.
-- Review scripts/audit_organizational_structure.sql and the rollout report first.

create table if not exists public.divisions (
  id text primary key,
  name text not null,
  description text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.divisions
  add column if not exists description text,
  add column if not exists is_active boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();
alter table public.departments add column if not exists division_id text;

do $$
declare
  division_key smallint;
  department_key smallint;
  item record;
  key_count integer := 0;
begin
  if exists (
    select 1 from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('get_organizational_structure', 'can_read_organizational_structure')
      and (p.pronargs <> 0 or p.proretset or p.prokind <> 'f'
        or p.prorettype <> case p.proname when 'get_organizational_structure' then 'jsonb'::regtype else 'boolean'::regtype end)
  ) then
    raise exception 'Unexpected organizational function signature or overload; review existing functions manually';
  end if;
  -- IF NOT EXISTS alone does not verify that an existing object is compatible.
  if exists (
    select 1 from (values
      ('divisions', 'id', 'text'::regtype), ('divisions', 'name', 'text'::regtype),
      ('divisions', 'description', 'text'::regtype), ('divisions', 'is_active', 'boolean'::regtype),
      ('divisions', 'created_at', 'timestamptz'::regtype), ('divisions', 'updated_at', 'timestamptz'::regtype),
      ('departments', 'division_id', 'text'::regtype)
    ) expected(table_name, column_name, column_type)
    left join pg_catalog.pg_attribute a on a.attrelid = ('public.' || expected.table_name)::regclass
      and a.attname = expected.column_name and not a.attisdropped
    where a.atttypid is distinct from expected.column_type
  ) then
    raise exception 'Incompatible organizational column types; review the schema before reconciliation';
  end if;
  select attnum into division_key from pg_catalog.pg_attribute
    where attrelid = 'public.divisions'::regclass and attname = 'id' and not attisdropped;
  select attnum into department_key from pg_catalog.pg_attribute
    where attrelid = 'public.departments'::regclass and attname = 'division_id' and not attisdropped;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.divisions'::regclass
    and contype = 'p' and conkey = array[division_key]) then
    raise exception 'Expected divisions primary key on id; no existing key will be replaced';
  end if;

  -- Only relax the exact CHECK from the archived draft, retaining its name.
  -- Live underscore IDs are legitimate identifiers, not records to rename.
  for item in select conname from pg_catalog.pg_constraint
    where conrelid = 'public.divisions'::regclass and contype = 'c'
      and pg_catalog.pg_get_expr(conbin, conrelid) = $expr$(id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)$expr$
  loop
    execute format('alter table public.divisions drop constraint %I', item.conname);
    execute format('alter table public.divisions add constraint %I check (id ~ %L)', item.conname, '^[a-z0-9]+([_-][a-z0-9]+)*$');
  end loop;

  for item in select *, pg_catalog.pg_get_constraintdef(oid) as definition from pg_catalog.pg_constraint
    where conrelid = 'public.departments'::regclass and contype = 'f' and department_key = any(conkey)
  loop
    key_count := key_count + 1;
    if item.conkey <> array[department_key] or item.confrelid <> 'public.divisions'::regclass
      or item.confkey <> array[division_key] or not item.convalidated or item.confdeltype not in ('r', 'n') then
      raise exception 'Unexpected department division FK %. Review it manually; no relationship will be guessed', item.conname;
    end if;
    if item.confdeltype = 'n' then
      -- The known draft used SET NULL. Tighten only that behavior, preserving
      -- the key name, columns, target, update action and deferrability.
      execute format('alter table public.departments drop constraint %I', item.conname);
      execute format('alter table public.departments add constraint %I %s', item.conname,
        replace(item.definition, 'ON DELETE SET NULL', 'ON DELETE RESTRICT'));
    end if;
  end loop;
  if key_count > 1 then
    raise exception 'Duplicate division foreign keys need manual review';
  elsif key_count = 0 then
    alter table public.departments add constraint departments_division_id_fkey
      foreign key (division_id) references public.divisions(id) on delete restrict;
  end if;
  -- Reuse a valid existing leading-column index, irrespective of its name.
  if not exists (select 1 from pg_catalog.pg_index where indrelid = 'public.departments'::regclass
    and indisvalid and indisready and indpred is null and indkey[0] = department_key) then
    create index departments_division on public.departments(division_id);
  end if;
end;
$$;

-- Narrow definer helper: only a boolean about auth.uid(), no parameters, no
-- returned Auth rows, no dynamic SQL, no writes, and an empty search_path.
-- Unlike has_role alone, this also rejects an already-issued JWT after an Auth
-- ban or soft deletion. Existing shared helpers and employee RLS stay unchanged.
create or replace function public.can_read_organizational_structure() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role('admin') and exists (
    select 1 from auth.users u where u.id = (select auth.uid())
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  );
$$;
-- CREATE OR REPLACE retains an existing owner and ACL. Never leave this definer
-- helper owned by an API role, and do not retain unrelated/default EXECUTE grants.
alter function public.can_read_organizational_structure() owner to postgres;
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
    where p.oid = 'public.can_read_organizational_structure()'::regprocedure and acl.grantee <> p.proowner
  loop
    execute format('revoke all privileges on function public.can_read_organizational_structure() from %s',
      case when item.grantee = 0 then 'PUBLIC' else pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(item.grantee)) end);
  end loop;
end;
$$;
grant execute on function public.can_read_organizational_structure() to authenticated;
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(p.proacl) acl
    where p.oid = 'public.can_read_organizational_structure()'::regprocedure and acl.grantee <> p.proowner
      and (acl.grantee <> 'authenticated'::regrole or acl.is_grantable)
  ) then
    raise exception 'Unexpected organizational helper execution grants remain; review grant ownership and delegation';
  end if;
end;
$$;

alter table public.divisions enable row level security;
-- Unknown permissive policies cannot override this restrictive SELECT guard.
-- Preserve unrelated policies; only the two feature-owned policies are replaced.
drop policy if exists "Admins can read divisions" on public.divisions;
create policy "Admins can read divisions" on public.divisions for select to authenticated
  using ((select public.can_read_organizational_structure()));
drop policy if exists "Organizational structure admin guard" on public.divisions;
create policy "Organizational structure admin guard" on public.divisions as restrictive for select to authenticated
  using ((select public.can_read_organizational_structure()));
-- PostgreSQL REVOKE on a table also revokes corresponding column privileges,
-- including SELECT/INSERT/UPDATE/REFERENCES grants made directly on columns.
-- No dynamic column list is needed. See PostgreSQL 17 sql-revoke documentation.
revoke all privileges on table public.divisions from public, anon, authenticated;
grant select on public.divisions to authenticated;

-- CREATE OR REPLACE preserves dependencies and replaces the manually created
-- same-signature RPC without creating an overload. Incompatible returns fail.
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
