-- Tests for 20261116230000_storage_organization_folders.sql: stored files are in their organization's
-- folder; through the API nobody reads, uploads or removes files in another organization's folder (in
-- sop-files and guideline-files; guideline-indexes stays service-role only); the compliance service must
-- use the version's own index folder; relocate_storage_path moves rows only into their organization's folder.
-- Only for a disposable LOCAL database with every migration and the seed applied. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text, p_hint text default null) returns void
language plpgsql as $$
declare rejected boolean := false; v_hint text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if sqlstate <> p_state then raise; end if;
    if p_hint is not null and v_hint is distinct from p_hint then
      raise exception 'Expected hint % but got % from %', p_hint, v_hint, p_sql;
    end if;
    rejected := true;
  end;
  assert rejected, 'Expected ' || p_state || coalesce(' (' || p_hint || ')', '') || ' from ' || p_sql;
end;
$$;
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
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner() to public;

-- MedCare: an Admin and an author with a published SOP whose file is in MedCare's folder, a deleted SOP
-- with a file at an old path (before organization folders). Other: an Admin and an author.
insert into auth.users (id, email, aud, role)
select ('98900000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'fold-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 4) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position") values
  ('98900000-0000-4000-8000-000000000001', 'Fold Med Admin', 'fold-1@test.invalid', 'MA', null, '+966512345601', null),
  ('98900000-0000-4000-8000-000000000002', 'Fold Med Author', 'fold-2@test.invalid', 'MU', 'pharmacovigilance', '+966512345602', 'Officer');
insert into public.user_roles (user_id, role) values
  ('98900000-0000-4000-8000-000000000001', 'admin'), ('98900000-0000-4000-8000-000000000002', 'author');
create temporary table fold_ids on commit drop as
select (select organization_id from public.profiles where id = '98900000-0000-4000-8000-000000000001') as medcare;
grant select on fold_ids to public;
insert into public.sops (id, title, department_id, author_id, current_version, status) values
  ('98900000-0000-4000-8000-0000000000b1', 'Fold Med Published', 'pharmacovigilance', '98900000-0000-4000-8000-000000000002', 1, 'published'),
  ('98900000-0000-4000-8000-0000000000b2', 'Fold Med Deleted', 'pharmacovigilance', '98900000-0000-4000-8000-000000000002', 1, 'draft');
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
select '98900000-0000-4000-8000-0000000000b1', 1, 'med.pdf', 'pdf', f.medcare || '/98900000-0000-4000-8000-000000000002/98900000-0000-4000-8000-0000000000f1.pdf', 1,
  '98900000-0000-4000-8000-000000000002' from fold_ids f;
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('98900000-0000-4000-8000-0000000000b2', 1, 'old.pdf', 'pdf', '98900000-0000-4000-8000-000000000002/98900000-0000-4000-8000-0000000000f2.pdf', 1,
  '98900000-0000-4000-8000-000000000002');
update public.sops set deleted_at = now() where id = '98900000-0000-4000-8000-0000000000b2';
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'sop-files', f.medcare || '/98900000-0000-4000-8000-000000000002/98900000-0000-4000-8000-0000000000f1.pdf',
  '98900000-0000-4000-8000-000000000002', '{"mimetype": "application/pdf", "size": 1}' from fold_ids f;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'guideline-files', f.medcare || '/files/98900000-0000-4000-8000-0000000000f3.pdf',
  '98900000-0000-4000-8000-000000000001', '{"mimetype": "application/pdf", "size": 1}' from fold_ids f;

insert into public.organizations (id, name) values ('98900000-0000-4000-8000-0000000000aa', 'Fold Other');
insert into public.departments (id, name, initials, organization_id)
values ('fold-other-pv', 'Pharmacovigilance', 'PV', '98900000-0000-4000-8000-0000000000aa');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id) values
  ('98900000-0000-4000-8000-000000000003', 'Fold Other Admin', 'fold-3@test.invalid', 'OA', null, '+966512345603', null, '98900000-0000-4000-8000-0000000000aa'),
  ('98900000-0000-4000-8000-000000000004', 'Fold Other Author', 'fold-4@test.invalid', 'OU', 'fold-other-pv', '+966512345604', 'Officer', '98900000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values
  ('98900000-0000-4000-8000-000000000003', 'admin'), ('98900000-0000-4000-8000-000000000004', 'author');
insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size,
  created_by, processing_status, organization_id)
values ('98900000-0000-4000-8000-0000000000d1', 'GVP', '3.0', current_date, 'https://www.sfda.gov.sa/gvp', 'gvp3.pdf',
  '98900000-0000-4000-8000-0000000000aa/files/98900000-0000-4000-8000-0000000000d1.pdf', 1, '98900000-0000-4000-8000-000000000003',
  'processing', '98900000-0000-4000-8000-0000000000aa');
set constraints all immediate;
set constraints all deferred;

do $$
declare
  medcare uuid := (select f.medcare from fold_ids f);
  other constant uuid := '98900000-0000-4000-8000-0000000000aa';
  med_admin constant uuid := '98900000-0000-4000-8000-000000000001';
  med_author constant uuid := '98900000-0000-4000-8000-000000000002';
  other_admin constant uuid := '98900000-0000-4000-8000-000000000003';
  other_author constant uuid := '98900000-0000-4000-8000-000000000004';
  other_draft constant uuid := '98900000-0000-4000-8000-0000000000d1';
  med_file text := (select f.medcare || '/98900000-0000-4000-8000-000000000002/98900000-0000-4000-8000-0000000000f1.pdf' from fold_ids f);
  old_path constant text := '98900000-0000-4000-8000-000000000002/98900000-0000-4000-8000-0000000000f2.pdf';
begin
  assert exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'Organization folder only' and not polpermissive);

  -- ---------- Reading: only one's own organization's folder ----------
  perform pg_temp.act_as(med_admin);
  assert exists (select 1 from storage.objects where name = med_file), 'MedCare''s Admin reads MedCare''s published SOP file';
  assert exists (select 1 from storage.objects where bucket_id = 'guideline-files' and name like medcare || '/files/%'), 'and its GVP files';
  perform pg_temp.act_as(other_admin);
  assert not exists (select 1 from storage.objects where bucket_id in ('sop-files', 'guideline-files') and name like medcare || '/%'),
    'Other''s Admin reads no file of MedCare''s folder';

  -- ---------- Uploading: only into one's own folder, in the new paths ----------
  perform pg_temp.act_as(other_author);
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)',
    'sop-files', medcare || '/' || other_author || '/' || gen_random_uuid() || '.pdf', other_author), '42501');
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)',
    'sop-files', other_author || '/' || gen_random_uuid() || '.pdf', other_author), '42501');   -- the old path
  insert into storage.objects (bucket_id, name, owner_id) values ('sop-files', other || '/' || other_author || '/' || gen_random_uuid() || '.pdf', other_author);
  perform pg_temp.act_as(other_admin);
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)',
    'guideline-files', medcare || '/files/' || gen_random_uuid() || '.pdf', other_admin), '42501');
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)',
    'guideline-files', 'files/' || gen_random_uuid() || '.pdf', other_admin), '42501');   -- the old path
  insert into storage.objects (bucket_id, name, owner_id) values ('guideline-files', other || '/files/' || gen_random_uuid() || '.pdf', other_admin);
  -- The checks of a new upload ask for the new path too.
  perform pg_temp.act_as(other_author, 'postgres');
  perform pg_temp.expect_error(format('select public.check_sop_file(%L, %L)', other_author || '/' || gen_random_uuid() || '.pdf', 'a.pdf'), '23514');
  perform pg_temp.act_as(other_admin, 'postgres');
  perform pg_temp.expect_error(format('select public.check_guideline_file(%L)', 'files/' || gen_random_uuid() || '.pdf'), 'P0002', 'file-missing');
  perform pg_temp.expect_error(format('select public.check_guideline_file(%L)', medcare || '/files/' || gen_random_uuid() || '.pdf'), 'P0002', 'file-missing');

  -- ---------- The compliance service: the version's own index folder only ----------
  perform pg_temp.act_as(null, 'service_role');
  perform pg_temp.expect_error(format('select public.complete_guideline_processing(%L, %L, %L)', other_draft, 'versions/' || other_draft, '{}'), '22023');
  perform pg_temp.expect_error(format('select public.complete_guideline_processing(%L, %L, %L)', other_draft, medcare || '/versions/' || other_draft, '{}'), '22023');
  perform public.complete_guideline_processing(other_draft, other || '/versions/' || other_draft, '{}'::jsonb);

  -- ---------- relocate_storage_path: only into the row's organization's folder ----------
  assert public.relocate_storage_path('sop-files', old_path, other || '/' || old_path) = 0, 'not into another organization''s folder';
  -- The deleted SOP's version is moved too (and only its path may change).
  assert public.relocate_storage_path('sop-files', old_path, medcare || '/' || old_path) = 1, 'moved into MedCare''s folder';
  perform pg_temp.as_owner();
  assert (select storage_path from public.sop_versions where sop_id = '98900000-0000-4000-8000-0000000000b2') = medcare || '/' || old_path;
  perform pg_temp.expect_error($q$update public.sop_versions set file_name = 'changed' where sop_id = '98900000-0000-4000-8000-0000000000b2'$q$, '23514');
  assert not has_function_privilege('authenticated', 'public.relocate_storage_path(text, text, text)', 'execute'), 'service role only';
  assert has_function_privilege('service_role', 'public.relocate_storage_path(text, text, text)', 'execute');
end;
$$;

rollback;
