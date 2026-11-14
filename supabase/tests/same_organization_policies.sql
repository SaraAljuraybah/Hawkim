-- Tests for 20261116150000_same_organization_policies.sql: through the API, nobody reads, counts or
-- changes another organization's rows in any table, whatever the table grants are.
-- The checks run with the broadest grants the API roles could have (select, insert, update and delete on
-- every table, as on a project with Supabase's default grants), so the policies alone are what stops it.
-- Every table with organization_id is checked (found in the catalog, not listed by hand).
-- Only for a disposable LOCAL database with every migration and the seed applied. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.act_as(p_user uuid, p_role text default 'authenticated') returns void
language plpgsql as $$
begin
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
end;
$$;
create function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
-- For the caller set by act_as: how many rows of every organization table they can see that aren't their
-- organization's (p_own; null: any row at all), as 'table:count' for each table with such rows.
create function pg_temp.foreign_rows(p_own uuid) returns text
language plpgsql as $$
declare t text; n bigint; leaks text[] := '{}';
begin
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped)
    order by 1
  loop
    execute format('select count(*) from public.%I where organization_id is distinct from %L or %L is null', t, p_own, p_own) into n;
    if n > 0 then leaks := leaks || (t || ':' || n); end if;
  end loop;
  execute format('select count(*) from public.organizations where id is distinct from %L or %L is null', p_own, p_own) into n;
  if n > 0 then leaks := leaks || ('organizations:' || n); end if;
  return array_to_string(leaks, ', ');
end;
$$;
-- The number of rows a statement changed (as the caller), or the SQLSTATE it was refused with.
create function pg_temp.changed(p_sql text) returns text
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n::text;
exception when others then
  return sqlstate;
end;
$$;
grant execute on function pg_temp.act_as(uuid, text), pg_temp.as_owner(), pg_temp.foreign_rows(uuid), pg_temp.changed(text) to public;

-- The broadest grants the API roles could have.
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

-- ---------- Fixtures: MedCare (the seed's organization) and a second organization, Other ----------
insert into auth.users (id, email, aud, role)
select ('98100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'iso-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 5) n;
-- MedCare: an author in the seed's Pharmacovigilance department.
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
values ('98100000-0000-4000-8000-000000000001', 'Iso Med', 'iso-1@test.invalid', 'IM', 'pharmacovigilance', '+966512345601', 'Officer');
insert into public.user_roles (user_id, role) values ('98100000-0000-4000-8000-000000000001', 'author');

insert into public.organizations (id, name) values ('98100000-0000-4000-8000-0000000000aa', 'Iso Other');
insert into public.divisions (id, name, description, organization_id)
values ('iso-other-division', 'Iso Other Division', '', '98100000-0000-4000-8000-0000000000aa');
insert into public.departments (id, name, initials, division_id, organization_id)
values ('iso-other-department', 'Iso Other Department', 'IOD', 'iso-other-division', '98100000-0000-4000-8000-0000000000aa');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id) values
  ('98100000-0000-4000-8000-000000000002', 'Iso Other Author', 'iso-2@test.invalid', 'IO', 'iso-other-department', '+966512345602', 'Officer',
   '98100000-0000-4000-8000-0000000000aa'),
  ('98100000-0000-4000-8000-000000000003', 'Iso Other Admin', 'iso-3@test.invalid', 'IA', null, '+966512345603', null,
   '98100000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values
  ('98100000-0000-4000-8000-000000000002', 'author'), ('98100000-0000-4000-8000-000000000003', 'admin');
-- An SOP with its version, and a GVP version with a requirement, in Other.
insert into public.sops (id, title, department_id, author_id, current_version)
values ('98100000-0000-4000-8000-0000000000b1', 'Iso Other SOP', 'iso-other-department', '98100000-0000-4000-8000-000000000002', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('98100000-0000-4000-8000-0000000000b1', 1, 'a.pdf', 'pdf', 'iso/a.pdf', 1, '98100000-0000-4000-8000-000000000002');
insert into public.guideline_versions (id, name, version, effective_date, file_name, organization_id)
values ('98100000-0000-4000-8000-0000000000c1', 'Iso GVP', '9.0', current_date, 'gvp.pdf', '98100000-0000-4000-8000-0000000000aa');
insert into public.guideline_requirements (guideline_version_id, code, module, section, section_title, short_title, page, summary)
values ('98100000-0000-4000-8000-0000000000c1', 'R1', 'I', '1', 'S', 'T', 1, 'Iso requirement');
set constraints all immediate;

do $$
declare
  medcare uuid := (select id from public.organizations where id <> '98100000-0000-4000-8000-0000000000aa');
  other constant uuid := '98100000-0000-4000-8000-0000000000aa';
  med_author constant uuid := '98100000-0000-4000-8000-000000000001';
  other_author constant uuid := '98100000-0000-4000-8000-000000000002';
  other_admin constant uuid := '98100000-0000-4000-8000-000000000003';
  no_profile constant uuid := '98100000-0000-4000-8000-000000000005';
  leaks text;
  result text;
begin
  -- Both organizations have rows the other could try to see.
  assert (select count(*) from public.departments where organization_id = medcare) > 0, 'MedCare has departments';
  assert (select count(*) from public.guideline_requirements where organization_id = medcare) > 0, 'MedCare has requirements';
  assert (select count(*) from public.sops where organization_id = other) = 1;

  -- ---------- The policy is on every table with organization_id ----------
  assert not exists (
    select 1 from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped)
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'Same organization only'
                        and not p.polpermissive and p.polcmd = '*' and p.polroles = '{0}')),
    'Every organization table has the restrictive policy for all commands and roles';

  -- ---------- Reading and counting: only one's own organization's rows ----------
  perform pg_temp.act_as(other_author);
  leaks := pg_temp.foreign_rows(other);
  assert leaks = '', 'Other''s author sees other rows: ' || leaks;
  assert (select count(*) from public.departments) = 1 and (select count(*) from public.guideline_requirements) = 1,
    'Other''s author counts only Other''s rows';
  perform pg_temp.act_as(other_admin);
  leaks := pg_temp.foreign_rows(other);
  assert leaks = '', 'Other''s Admin sees other rows: ' || leaks;
  perform pg_temp.act_as(med_author);
  leaks := pg_temp.foreign_rows(medcare);
  assert leaks = '', 'MedCare''s author sees other rows: ' || leaks;
  assert not exists (select 1 from public.sops where id = '98100000-0000-4000-8000-0000000000b1'), 'not even by id';
  -- organizations has no read policy at all: it is read only through functions (get_organization_profile).
  assert (select count(*) from public.organizations) = 0, 'organizations isn''t readable directly, even one''s own row';
  -- Without an organization: nothing at all.
  perform pg_temp.act_as(no_profile);
  leaks := pg_temp.foreign_rows(null);
  assert leaks = '', 'A user without a profile sees rows: ' || leaks;
  perform pg_temp.act_as(null, 'anon');
  leaks := pg_temp.foreign_rows(null);
  assert leaks = '', 'Anonymous callers see rows: ' || leaks;

  -- ---------- Changing another organization's rows: nothing happens ----------
  perform pg_temp.act_as(other_admin);
  result := pg_temp.changed(format('update public.departments set description = %L where organization_id = %L', 'x', medcare));
  assert result = '0', 'update of MedCare''s departments: ' || result;
  result := pg_temp.changed(format('delete from public.guideline_requirements where organization_id = %L', medcare));
  assert result = '0', 'delete of MedCare''s requirements: ' || result;
  result := pg_temp.changed(format('update public.organizations set name = %L where id = %L', 'Taken', medcare));
  assert result = '0', 'rename of MedCare: ' || result;
  -- Adding rows directly is refused outright (no table has an insert policy: rows are added by functions),
  -- for another organization or one's own. (Which organization a row gets is tested in organizations.sql.)
  result := pg_temp.changed(format('insert into public.departments (id, name, initials, organization_id) values (%L, %L, %L, %L)',
    'iso-injected', 'Iso Injected', 'IIJ', medcare));
  assert result = '42501', 'insert into MedCare: ' || result;
  result := pg_temp.changed(format('insert into public.departments (id, name, initials) values (%L, %L, %L)',
    'iso-own', 'Iso Own', 'ION'));
  assert result = '42501', 'insert into its own organization: ' || result;
  result := pg_temp.changed(format('insert into public.user_roles (user_id, role) values (%L, %L)', med_author, 'reviewer'));
  assert result = '42501', 'a role for MedCare''s author: ' || result;
  result := pg_temp.changed(format(
    'insert into public.timeline_events (sop_id, type, actor_id, version) select s.id, %L, %L, 1 from public.sops s where s.organization_id = %L',
    'version-uploaded', other_admin, medcare));
  assert result = '0', 'events on MedCare''s SOPs (they can''t even be found): ' || result;
  perform pg_temp.as_owner();
  assert (select count(*) from public.departments where organization_id = medcare and description = 'x') = 0, 'nothing changed';
  assert (select count(*) from public.guideline_requirements where organization_id = medcare) > 0, 'nothing deleted';
  assert (select name from public.organizations where id = medcare) <> 'Taken', 'not renamed';
end;
$$;

rollback;
