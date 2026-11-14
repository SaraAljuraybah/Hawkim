-- Hawkim writes "and" instead of "&". This renames the stored names that still contain "&":
-- division names, department names and the organization's name (organization_settings).
--
-- - Only the name text changes. Every row keeps its id, so departments, staff, SOPs, positions and
--   reviews stay linked exactly as before (all references are by id, never by name).
-- - "A & B" and "A&B" both become "A and B" (spaces around the "&" collapse to one on each side).
-- - A row is skipped (left unchanged, with a NOTICE) when the new name would be too long for its
--   column rules, or would match another active division/department name (names are unique,
--   case-insensitively, among active rows). Skipped rows can be renamed by hand afterwards.
-- - Departments whose file cleanup is pending can't be edited (guard_pending_department_edit), so they
--   are skipped as well.
-- - Every rename is recorded in public.ampersand_name_changes (old and new name), which
--   scripts/rollback_ampersand_names.sql uses to restore the old names.
-- - Submitted Request Hawkim records (access_requests) are not changed: they are what was submitted.

create table public.ampersand_name_changes (
  id bigint generated always as identity primary key,
  entity text not null check (entity in ('division', 'department', 'organization')),
  entity_id text not null,
  old_name text not null,
  new_name text not null,
  renamed_at timestamptz not null default now()
);
alter table public.ampersand_name_changes enable row level security;
revoke all on public.ampersand_name_changes from public, anon, authenticated, service_role;

create function pg_temp.without_ampersand(p_name text) returns text
language sql immutable as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(p_name, '\s*&\s*', ' and ', 'g'))
$$;

do $$
declare item record; renamed text;
begin
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);

  for item in select id, name from public.divisions where name like '%&%' order by id for update loop
    renamed := pg_temp.without_ampersand(item.name);
    if pg_catalog.char_length(renamed) > 100 or exists (
      select 1 from public.divisions d where d.id <> item.id and d.is_active is not false
        and pg_catalog.lower(pg_catalog.btrim(d.name)) = pg_catalog.lower(renamed)) then
      raise notice 'Division % (%) was not renamed: "%" is too long or already used', item.id, item.name, renamed;
      continue;
    end if;
    update public.divisions set name = renamed where id = item.id;
    insert into public.ampersand_name_changes(entity, entity_id, old_name, new_name)
      values ('division', item.id, item.name, renamed);
  end loop;

  for item in select id, name, deletion_job_id from public.departments
    where name like '%&%' and removed_at is null order by id for update loop
    renamed := pg_temp.without_ampersand(item.name);
    if item.deletion_job_id is not null or pg_catalog.char_length(renamed) > 60 or exists (
      select 1 from public.departments d where d.id <> item.id and d.removed_at is null
        and pg_catalog.lower(pg_catalog.btrim(d.name)) = pg_catalog.lower(renamed)) then
      raise notice 'Department % (%) was not renamed: "%" is too long, already used or pending cleanup', item.id, item.name, renamed;
      continue;
    end if;
    -- updated_at changes too, so an edit dialog opened before this ran asks to refresh instead of
    -- writing the old name back.
    update public.departments set name = renamed, updated_at = pg_catalog.clock_timestamp() where id = item.id;
    insert into public.ampersand_name_changes(entity, entity_id, old_name, new_name)
      values ('department', item.id, item.name, renamed);
  end loop;

  for item in select singleton, name from public.organization_settings where name like '%&%' for update loop
    renamed := pg_temp.without_ampersand(item.name);
    if pg_catalog.char_length(renamed) > 200 then
      raise notice 'The organization name was not renamed: "%" is too long', renamed;
      continue;
    end if;
    update public.organization_settings set name = renamed, updated_at = now() where singleton;
    insert into public.ampersand_name_changes(entity, entity_id, old_name, new_name)
      values ('organization', 'organization', item.name, renamed);
  end loop;
end;
$$;
