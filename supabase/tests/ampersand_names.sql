-- Tests for 20261113120000_ampersand_names.sql. The migration has already run on this database, so these
-- tests run its rename logic again on fixtures (as the database owner) and check what it does and skips:
-- "&" becomes "and" in division, department and organization names; ids and every link stay; a rename that
-- would clash with another name is skipped; and rollback_ampersand_names.sql can put the names back.
-- Only for a disposable LOCAL database with every migration applied; never the shared project.
-- Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

-- The fixtures (any rows the migration itself recorded are kept apart by id). Names are unique to this
-- test: a fixture named like a seed department (e.g. "Finance and Administration") would be skipped as a clash.
insert into public.divisions (id, name, description) values
  ('amp-rnd', 'Research & Development', ''), ('amp-qc', 'Quality&Compliance', ''),
  ('amp-clash', 'Legal & Governance', ''), ('amp-taken', 'Legal and Governance', '');
insert into public.departments (id, name, initials, division_id) values
  ('amp-fa', 'Amp Finance & Administration', 'FA', 'amp-rnd'), ('amp-plain', 'Pharmacovigilance Amp', 'PA', 'amp-qc');
insert into auth.users (id) values ('9b000000-0000-4000-8000-000000000001');
insert into public.profiles (id, full_name, email, initials, department_id, "position")
values ('9b000000-0000-4000-8000-000000000001', 'Amp Person', 'amp@test.invalid', 'AP', 'amp-fa', 'Officer');
-- The organization's name (organizations.name since 20261116140000; MedCare's row here).
update public.organizations set name = 'Riyadh Pharma & Co';
delete from public.ampersand_name_changes;

-- The migration's DO block, run again.
create function pg_temp.without_ampersand(p_name text) returns text
language sql immutable as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(p_name, '\s*&\s*', ' and ', 'g'))
$$;
do $$
declare item record; renamed text;
begin
  for item in select id, name from public.divisions where name like '%&%' order by id for update loop
    renamed := pg_temp.without_ampersand(item.name);
    if pg_catalog.char_length(renamed) > 100 or exists (
      select 1 from public.divisions d where d.id <> item.id and d.is_active is not false
        and pg_catalog.lower(pg_catalog.btrim(d.name)) = pg_catalog.lower(renamed)) then
      continue;
    end if;
    update public.divisions set name = renamed where id = item.id;
    insert into public.ampersand_name_changes(entity, entity_id, old_name, new_name) values ('division', item.id, item.name, renamed);
  end loop;
  for item in select id, name, deletion_job_id from public.departments where name like '%&%' and removed_at is null order by id for update loop
    renamed := pg_temp.without_ampersand(item.name);
    if item.deletion_job_id is not null or pg_catalog.char_length(renamed) > 60 or exists (
      select 1 from public.departments d where d.id <> item.id and d.removed_at is null
        and pg_catalog.lower(pg_catalog.btrim(d.name)) = pg_catalog.lower(renamed)) then
      continue;
    end if;
    update public.departments set name = renamed, updated_at = pg_catalog.clock_timestamp() where id = item.id;
    insert into public.ampersand_name_changes(entity, entity_id, old_name, new_name) values ('department', item.id, item.name, renamed);
  end loop;
  -- The migration renamed organization_settings' one row; since 20261116140000 the name is on organizations.
  for item in select id, name from public.organizations where name like '%&%' for update loop
    renamed := pg_temp.without_ampersand(item.name);
    update public.organizations set name = renamed, updated_at = now() where id = item.id;
    insert into public.ampersand_name_changes(entity, entity_id, old_name, new_name) values ('organization', 'organization', item.name, renamed);
  end loop;
end;
$$;

do $$
begin
  assert (select name from public.divisions where id = 'amp-rnd') = 'Research and Development';
  assert (select name from public.divisions where id = 'amp-qc') = 'Quality and Compliance', '"A&B" gets spaces too';
  assert (select name from public.divisions where id = 'amp-clash') = 'Legal & Governance', 'A clash is skipped, not merged';
  assert (select name from public.departments where id = 'amp-fa') = 'Amp Finance and Administration';
  assert (select name from public.organizations) = 'Riyadh Pharma and Co';
  -- Ids and links are untouched.
  assert (select division_id from public.departments where id = 'amp-fa') = 'amp-rnd';
  assert (select department_id from public.profiles where id = '9b000000-0000-4000-8000-000000000001') = 'amp-fa';
  assert (select count(*) from public.ampersand_name_changes) = 4, 'Every rename recorded';
  assert not has_table_privilege('authenticated', 'public.ampersand_name_changes', 'select'), 'Not readable by the API';
end;
$$;

-- The rollback script's statements (without its own BEGIN/COMMIT) put the names back.
update public.divisions d set name = c.old_name from public.ampersand_name_changes c
where c.entity = 'division' and c.entity_id = d.id and d.name = c.new_name;
update public.departments d set name = c.old_name, updated_at = pg_catalog.clock_timestamp() from public.ampersand_name_changes c
where c.entity = 'department' and c.entity_id = d.id and d.name = c.new_name and d.deletion_job_id is null;
update public.organizations o set name = c.old_name, updated_at = now() from public.ampersand_name_changes c
where c.entity = 'organization' and o.id = c.organization_id and o.name = c.new_name;
do $$
begin
  assert (select name from public.divisions where id = 'amp-rnd') = 'Research & Development';
  assert (select name from public.departments where id = 'amp-fa') = 'Amp Finance & Administration';
  assert (select name from public.organizations) = 'Riyadh Pharma & Co';
end;
$$;

rollback;
