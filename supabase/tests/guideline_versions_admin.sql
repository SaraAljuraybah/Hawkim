-- Tests for 20261108120000_guideline_versions_admin.sql. Only for a disposable LOCAL Supabase/PostgreSQL
-- database with every migration applied; never run it against the shared Supabase project. Everything
-- is rolled back. Uploaded files are stand-in storage.objects rows. Two admins acting at the same
-- moment need two connections, so that isn't covered here.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text, p_hint text default null) returns void
language plpgsql as $$
declare v_rejected boolean := false; v_hint text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if sqlstate <> p_state then raise; end if;
    assert p_hint is null or v_hint = p_hint, 'Expected hint ' || p_hint || ', got ' || coalesce(v_hint, '(none)') || ' from ' || p_sql;
    v_rejected := true;
  end;
  assert v_rejected, 'Expected ' || p_state || ' from ' || p_sql;
end;
$$;
create function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end;
$$;
create function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
-- A file "uploaded" by p_owner, as Storage records it. Returns its path.
create function pg_temp.upload(p_owner uuid, p_type text default 'application/pdf', p_size bigint default 2048) returns text
language plpgsql as $$
declare v_path text := 'files/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('guideline-files', v_path, p_owner::text, jsonb_build_object('mimetype', p_type, 'size', p_size));
  return v_path;
end;
$$;
create function pg_temp.audits(p_action text, p_entity text) returns integer
language sql as $$
  select count(*)::integer from public.organization_management_audit a where a.action = p_action and a.entity_id = p_entity;
$$;

insert into public.divisions (id, name) values ('gv-a', 'GV Division');
insert into public.departments (id, name, initials, division_id) values ('gv-home', 'GV Home', 'GH', 'gv-a');
-- 1 and 2 admins, 3 banned admin, 4 author.
insert into auth.users (id) select ('95000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 4) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
select ('95000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'GV Person', 'gv-' || n || '@test.invalid', 'GP', 'gv-home', '+966512345678', 'Title'
from generate_series(1, 4) n;
insert into public.user_roles (user_id, role) values
  ('95000000-0000-4000-8000-000000000001', 'admin'), ('95000000-0000-4000-8000-000000000002', 'admin'),
  ('95000000-0000-4000-8000-000000000003', 'admin'), ('95000000-0000-4000-8000-000000000004', 'author');
update auth.users set banned_until = now() + interval '1 day' where id = '95000000-0000-4000-8000-000000000003';

-- Two published versions, newest last; 900.0 is current (added now, after any seeded version).
insert into public.guideline_versions (id, name, version, issued_date, effective_date, file_name, added_at) values
  ('95100000-0000-4000-8000-000000000001', 'GV Guideline', '899.0', '2020-01-01', '2020-02-01', 'GV-899.pdf', now() - interval '400 days'),
  ('95100000-0000-4000-8000-000000000002', 'GV Guideline', '900.0', '2021-01-01', '2021-02-01', 'GV-900.pdf', now());

do $$
declare
  admin1 constant uuid := '95000000-0000-4000-8000-000000000001';
  admin2 constant uuid := '95000000-0000-4000-8000-000000000002';
  banned constant uuid := '95000000-0000-4000-8000-000000000003';
  author constant uuid := '95000000-0000-4000-8000-000000000004';
  previous constant uuid := '95100000-0000-4000-8000-000000000001';
  current_id constant uuid := '95100000-0000-4000-8000-000000000002';
  sfda constant text := 'https://www.sfda.gov.sa/en/regulations/gvp';
  today date := (now() at time zone 'Asia/Riyadh')::date;
  v_published integer;
  v_path text;
  v_other_path text;
  v_draft uuid;
  v_second uuid;
  v_returned text;
  v_draft_row public.guideline_version_drafts;
  v_version_row public.guideline_versions;
  v_count integer;
  v_fn text;
begin
  select count(*) into v_published from public.guideline_versions;
  assert public.current_guideline_version() = current_id, 'Setup: 900.0 is current';

  -- ---------- Grants ----------
  foreach v_fn in array array[
    'public.create_guideline_draft(text, text, date, text, text, text)', 'public.update_guideline_draft(uuid, text, text, date, text)',
    'public.update_guideline_version(uuid, text, date, text)', 'public.attach_guideline_file(uuid, text)',
    'public.delete_guideline_draft(uuid)', 'public.is_unused_guideline_path(text)'
  ] loop
    assert has_function_privilege('authenticated', v_fn, 'execute'), v_fn || ' is for signed-in users';
    assert not has_function_privilege('anon', v_fn, 'execute'), v_fn || ' is not for anon';
    assert not has_function_privilege('public', v_fn, 'execute'), v_fn || ' is not for public';
  end loop;
  foreach v_fn in array array[
    'public.check_guideline_file(text)', 'public.check_guideline_details(text, date, text, date)',
    'public.check_new_guideline_number(text, uuid)', 'public.guideline_number_parts(text)'
  ] loop
    assert not has_function_privilege('authenticated', v_fn, 'execute'), v_fn || ' is internal';
    assert not has_function_privilege('anon', v_fn, 'execute'), v_fn || ' is internal';
  end loop;
  assert not has_table_privilege('authenticated', 'public.guideline_version_drafts', 'insert'), 'No direct insert';
  assert not has_table_privilege('authenticated', 'public.guideline_version_drafts', 'update'), 'No direct update';
  assert not has_table_privilege('authenticated', 'public.guideline_version_drafts', 'delete'), 'No direct delete';
  assert not has_table_privilege('anon', 'public.guideline_version_drafts', 'select'), 'Anon can''t read';
  assert (select not b.public and b.file_size_limit = 20971520 and b.allowed_mime_types = array['application/pdf']
          from storage.buckets b where b.id = 'guideline-files'), 'Private PDF bucket of 20 MB';

  -- ---------- Adding a version ----------
  v_path := pg_temp.upload(admin1);
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''901.0'', %L, %L, %L, ''a.pdf'')', today, sfda, v_path), '42501');
  perform pg_temp.act_as(banned);
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''901.0'', %L, %L, %L, ''a.pdf'')', today, sfda, v_path), '42501');

  perform pg_temp.act_as(admin1);
  v_draft := public.create_guideline_draft('  GV Added  ', ' 901.0 ', '2026-01-15', sfda, v_path, ' Drug-GVP901.pdf ');
  perform pg_temp.as_owner();
  select * into v_draft_row from public.guideline_version_drafts d where d.id = v_draft;
  assert v_draft_row.name = 'GV Added' and v_draft_row.version = '901.0' and v_draft_row.issued_date = '2026-01-15'
     and v_draft_row.source = sfda and v_draft_row.file_name = 'Drug-GVP901.pdf' and v_draft_row.storage_path = v_path
     and v_draft_row.file_size = 2048 and v_draft_row.created_by = admin1, 'Added with trimmed values and the file size from Storage';
  assert pg_temp.audits('add-guideline-version', v_draft::text) = 1, 'Adding is audited';
  -- It is never current, and no published version was added.
  assert public.current_guideline_version() = current_id, 'Still 900.0 current';
  assert (select count(*) from public.guideline_versions) = v_published, 'No published version added';

  -- Refused: each rule, with its hint.
  v_other_path := pg_temp.upload(admin1);
  perform pg_temp.act_as(admin1);
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', %L, %L, %L, %L, ''a.pdf'')', '902', today, sfda, v_other_path), '23514', 'version-invalid');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', %L, %L, %L, %L, ''a.pdf'')', 'v902.0', today, sfda, v_other_path), '23514', 'version-invalid');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', %L, %L, %L, %L, ''a.pdf'')', '902.0.1', today, sfda, v_other_path), '23514', 'version-invalid');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', %L, %L, %L, %L, ''a.pdf'')', '900.0', today, sfda, v_other_path), '23505', 'version-exists');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', %L, %L, %L, %L, ''a.pdf'')', '899.00', today, sfda, v_other_path), '23505', 'version-exists');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', %L, %L, %L, %L, ''a.pdf'')', '901.00', today, sfda, v_other_path), '23505', 'version-exists');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', %L, %L, %L, %L, ''a.pdf'')', '899.5', today, sfda, v_other_path), '23514', 'version-not-higher');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', %L, %L, %L, %L, ''a.pdf'')', '9.0', today, sfda, v_other_path), '23514', 'version-not-higher');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(%L, ''902.0'', %L, %L, %L, ''a.pdf'')', '   ', today, sfda, v_other_path), '23514', 'title-invalid');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(%L, ''902.0'', %L, %L, %L, ''a.pdf'')', repeat('x', 101), today, sfda, v_other_path), '23514', 'title-invalid');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', null, %L, %L, ''a.pdf'')', sfda, v_other_path), '23514', 'issued-required');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today + 1, sfda, v_other_path), '23514', 'issued-after-added');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, 'http://www.sfda.gov.sa/x', v_other_path), '23514', 'source-invalid');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, 'https://sfda.gov.sa.example.com/x', v_other_path), '23514', 'source-invalid');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, 'https://notsfda.gov.sa/x', v_other_path), '23514', 'source-invalid');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, 'https://www.sfda.gov.sa/' || repeat('x', 280), v_other_path), '23514', 'source-invalid');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, null, %L, ''a.pdf'')', today, v_other_path), '23514', 'source-invalid');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.docx'')', today, sfda, v_other_path), '23514', 'file-not-pdf');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, sfda, 'files/' || gen_random_uuid() || '.pdf'), 'P0002', 'file-missing');
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, sfda, 'other/' || gen_random_uuid() || '.pdf'), 'P0002', 'file-missing');
  -- A file outside files/, even one the admin owns.
  perform pg_temp.as_owner();
  v_returned := 'other/' || gen_random_uuid() || '.pdf';
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('guideline-files', v_returned, admin1::text, '{"mimetype": "application/pdf", "size": 10}');
  perform pg_temp.act_as(admin1);
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, sfda, v_returned), 'P0002', 'file-missing');
  -- A file another admin uploaded.
  perform pg_temp.as_owner();
  v_returned := pg_temp.upload(admin2);
  perform pg_temp.act_as(admin1);
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, sfda, v_returned), 'P0002', 'file-missing');
  perform pg_temp.as_owner();
  v_returned := pg_temp.upload(admin1, 'application/msword');
  perform pg_temp.act_as(admin1);
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, sfda, v_returned), '23514', 'file-not-pdf');
  perform pg_temp.as_owner();
  v_returned := pg_temp.upload(admin1, 'application/pdf', 20971521);
  perform pg_temp.act_as(admin1);
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, sfda, v_returned), '23514', 'file-too-large');
  -- A file another version already uses.
  perform pg_temp.expect_error(format('select public.create_guideline_draft(''T'', ''902.0'', %L, %L, %L, ''a.pdf'')', today, sfda, v_path), '23505', 'file-in-use');
  -- Allowed: a capitalised link, the root of the site, and the largest file.
  perform pg_temp.as_owner();
  v_returned := pg_temp.upload(admin1, 'application/pdf', 20971520);
  perform pg_temp.act_as(admin1);
  v_second := public.create_guideline_draft('GV Second', '1000.0', today, 'HTTPS://SFDA.GOV.SA', v_returned, 'b.PDF');
  -- 901.10 is a new number, higher than 900.0 (numbers compare part by part).
  v_returned := public.create_guideline_draft('GV Third', '901.10', today, sfda, v_other_path, 'c.pdf');
  perform public.delete_guideline_draft(v_returned::uuid);

  -- Admins read added versions; others don't.
  assert (select count(*) from public.guideline_version_drafts) >= 2, 'An admin reads added versions';
  perform pg_temp.act_as(author);
  assert (select count(*) from public.guideline_version_drafts) = 0, 'An author reads none';
  perform pg_temp.act_as(banned);
  assert (select count(*) from public.guideline_version_drafts) = 0, 'A banned admin reads none';

  -- ---------- Editing an added version ----------
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(format('select public.update_guideline_draft(%L, ''T'', ''905.0'', %L, %L)', v_draft, today, sfda), '42501');
  perform pg_temp.act_as(admin2);
  perform public.update_guideline_draft(v_draft, ' GV Renamed ', '905.5', '2026-02-01', 'https://sfda.gov.sa/gvp');
  perform pg_temp.as_owner();
  select * into v_draft_row from public.guideline_version_drafts d where d.id = v_draft;
  assert v_draft_row.name = 'GV Renamed' and v_draft_row.version = '905.5' and v_draft_row.issued_date = '2026-02-01'
     and v_draft_row.source = 'https://sfda.gov.sa/gvp' and v_draft_row.storage_path = v_path and v_draft_row.file_name = 'Drug-GVP901.pdf'
     and v_draft_row.file_size = 2048 and v_draft_row.created_by = admin1, 'Edited; the PDF stays';
  assert pg_temp.audits('update-guideline-version', v_draft::text) = 1, 'Editing is audited';
  perform pg_temp.act_as(admin2);
  -- It may keep its own number (905.05 is the same number as 905.5).
  perform public.update_guideline_draft(v_draft, 'GV Renamed', '905.5', '2026-02-01', 'https://sfda.gov.sa/gvp');
  perform public.update_guideline_draft(v_draft, 'GV Renamed', '905.05', '2026-02-01', 'https://sfda.gov.sa/gvp');
  perform public.update_guideline_draft(v_draft, 'GV Renamed', '905.5', '2026-02-01', 'https://sfda.gov.sa/gvp');
  perform pg_temp.expect_error(format('select public.update_guideline_draft(%L, ''T'', ''1000.0'', %L, %L)', v_draft, today, sfda), '23505', 'version-exists');
  perform pg_temp.expect_error(format('select public.update_guideline_draft(%L, ''T'', ''900.0'', %L, %L)', v_draft, today, sfda), '23505', 'version-exists');
  perform pg_temp.expect_error(format('select public.update_guideline_draft(%L, ''T'', ''800.0'', %L, %L)', v_draft, today, sfda), '23514', 'version-not-higher');
  perform pg_temp.expect_error(format('select public.update_guideline_draft(%L, ''T'', ''905.0'', %L, %L)', v_draft, today + 1, sfda), '23514', 'issued-after-added');
  perform pg_temp.expect_error(format('select public.update_guideline_draft(%L, '''', ''905.0'', %L, %L)', v_draft, today, sfda), '23514', 'title-invalid');
  perform pg_temp.expect_error(format('select public.update_guideline_draft(%L, ''T'', ''905.0'', %L, %L)', v_draft, today, 'https://example.com'), '23514', 'source-invalid');
  perform pg_temp.expect_error(format('select public.update_guideline_draft(%L, ''T'', ''905.0'', %L, %L)', gen_random_uuid(), today, sfda), 'P0002');
  -- A published version isn't an added one.
  perform pg_temp.expect_error(format('select public.update_guideline_draft(%L, ''T'', ''905.0'', %L, %L)', current_id, today, sfda), 'P0002');

  -- ---------- Editing a published version ----------
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(format('select public.update_guideline_version(%L, ''T'', %L, %L)', current_id, today, sfda), '42501');
  perform pg_temp.act_as(admin1);
  perform public.update_guideline_version(current_id, ' GV Current Title ', '2020-12-31', sfda);
  perform pg_temp.as_owner();
  select * into v_version_row from public.guideline_versions g where g.id = current_id;
  assert v_version_row.name = 'GV Current Title' and v_version_row.issued_date = '2020-12-31' and v_version_row.source = sfda
     and v_version_row.version = '900.0' and v_version_row.file_name = 'GV-900.pdf' and v_version_row.effective_date = '2021-02-01'
     and v_version_row.storage_path is null and v_version_row.file_size is null, 'Only the title, issue date and source change';
  assert pg_temp.audits('update-guideline-version', current_id::text) = 1, 'Editing is audited';
  assert public.current_guideline_version() = current_id, 'Editing doesn''t change which is current';
  perform pg_temp.act_as(admin1);
  -- The issue date can't be after the day it was added (399 days ago for 899.0).
  perform pg_temp.expect_error(format('select public.update_guideline_version(%L, ''T'', %L, %L)', previous, today - 10, sfda), '23514', 'issued-after-added');
  perform public.update_guideline_version(previous, 'GV Guideline', today - 401, sfda);
  perform pg_temp.expect_error(format('select public.update_guideline_version(%L, ''T'', %L, %L)', current_id, today, 'https://www.sfda.gov.sa.evil.test/'), '23514', 'source-invalid');
  perform pg_temp.expect_error(format('select public.update_guideline_version(%L, ''T'', null, %L)', current_id, sfda), '23514', 'issued-required');
  perform pg_temp.expect_error(format('select public.update_guideline_version(%L, ''T'', %L, %L)', v_draft, today, sfda), 'P0002');

  -- ---------- Adding the PDF to a published version ----------
  perform pg_temp.as_owner();
  v_path := pg_temp.upload(admin1, 'application/pdf', 4096);
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(format('select public.attach_guideline_file(%L, %L)', previous, v_path), '42501');
  perform pg_temp.act_as(admin1);
  perform public.attach_guideline_file(previous, v_path);
  perform pg_temp.as_owner();
  select * into v_version_row from public.guideline_versions g where g.id = previous;
  assert v_version_row.storage_path = v_path and v_version_row.file_size = 4096 and v_version_row.file_name = 'GV-899.pdf'
     and v_version_row.version = '899.0', 'The PDF is added; the file name stays';
  assert pg_temp.audits('attach-guideline-file', previous::text) = 1, 'Adding the PDF is audited';
  assert public.current_guideline_version() = current_id, 'Adding a PDF doesn''t change which is current';
  v_other_path := pg_temp.upload(admin1);
  perform pg_temp.act_as(admin1);
  -- Never replaced.
  perform pg_temp.expect_error(format('select public.attach_guideline_file(%L, %L)', previous, v_other_path), '23505', 'file-exists');
  -- A file in use, missing, or not a PDF.
  perform pg_temp.expect_error(format('select public.attach_guideline_file(%L, %L)', current_id, v_path), '23505', 'file-in-use');
  perform pg_temp.expect_error(format('select public.attach_guideline_file(%L, %L)', current_id, 'files/' || gen_random_uuid() || '.pdf'), 'P0002', 'file-missing');
  perform pg_temp.expect_error(format('select public.attach_guideline_file(%L, %L)', v_draft, v_other_path), 'P0002');
  perform pg_temp.expect_error(format('select public.attach_guideline_file(%L, %L)', gen_random_uuid(), v_other_path), 'P0002');
  -- The current version too.
  perform public.attach_guideline_file(current_id, v_other_path);
  perform pg_temp.as_owner();
  assert (select g.storage_path = v_other_path and g.file_size = 2048 from public.guideline_versions g where g.id = current_id), 'The current version gets its PDF';

  -- ---------- Storage ----------
  perform pg_temp.act_as(admin1);
  assert (select count(*) from storage.objects o where o.bucket_id = 'guideline-files') > 0, 'Admins read guideline files';
  perform pg_temp.act_as(author);
  -- Since 20261108140000 active users may read the PDFs of published versions, and nothing else.
  assert not exists (select 1 from storage.objects o where o.bucket_id = 'guideline-files' and not public.is_published_guideline_path(o.name)),
    'Others read no unpublished guideline file';
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name, owner_id) values (''guideline-files'', %L, %L)', 'files/' || gen_random_uuid() || '.pdf', author), '42501');
  perform pg_temp.act_as(admin1);
  insert into storage.objects (bucket_id, name, owner_id) values ('guideline-files', 'files/' || gen_random_uuid() || '.pdf', admin1::text);
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name, owner_id) values (''guideline-files'', %L, %L)', 'other/' || gen_random_uuid() || '.pdf', admin1), '42501');
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name, owner_id) values (''guideline-files'', %L, %L)', 'files/x.docx', admin1), '42501');
  -- A path a version uses can't be uploaded again.
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name, owner_id) values (''guideline-files'', %L, %L)', v_path, admin1), '42501');
  assert public.is_unused_guideline_path('files/' || gen_random_uuid() || '.pdf') and not public.is_unused_guideline_path(v_path), 'is_unused_guideline_path';
  -- Removing: only a file no version uses. (A local Supabase may refuse any SQL delete from storage.)
  begin
    delete from storage.objects o where o.bucket_id = 'guideline-files' and o.name = v_path;
    get diagnostics v_count = row_count;
    assert v_count = 0, 'A file a version uses can''t be removed';
  exception when others then
    if sqlerrm not ilike '%storage api%' then raise; end if;
  end;

  -- ---------- Deleting an added version ----------
  perform pg_temp.as_owner();
  select d.storage_path into v_path from public.guideline_version_drafts d where d.id = v_draft;
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(format('select public.delete_guideline_draft(%L)', v_draft), '42501');
  perform pg_temp.act_as(admin2);
  v_returned := public.delete_guideline_draft(v_draft);
  assert v_returned = v_path, 'Returns the file to remove';
  perform pg_temp.as_owner();
  assert not exists (select 1 from public.guideline_version_drafts d where d.id = v_draft), 'Deleted';
  assert pg_temp.audits('delete-guideline-version', v_draft::text) = 1, 'Deleting is audited';
  assert public.is_unused_guideline_path(v_path), 'Its file can now be removed';
  perform pg_temp.act_as(admin2);
  perform pg_temp.expect_error(format('select public.delete_guideline_draft(%L)', v_draft), 'P0002');
  -- A published version can't be deleted.
  perform pg_temp.expect_error(format('select public.delete_guideline_draft(%L)', previous), 'P0002');
  perform pg_temp.expect_error(format('select public.delete_guideline_draft(%L)', current_id), 'P0002');
  perform pg_temp.as_owner();
  assert (select count(*) from public.guideline_versions) = v_published, 'Every published version is kept';
  assert public.current_guideline_version() = current_id, 'Still 900.0 current';

  -- ---------- The tables refuse bad values directly too ----------
  perform pg_temp.expect_error(format('update public.guideline_versions set source = ''https://example.com'' where id = %L', previous), '23514');
  perform pg_temp.expect_error(format('update public.guideline_versions set file_size = 20971521 where id = %L', previous), '23514');
  perform pg_temp.expect_error(format('update public.guideline_versions set storage_path = %L where id = %L', v_other_path, previous), '23505');
  perform pg_temp.expect_error(format('update public.guideline_version_drafts set name = '' padded '' where id = %L', v_second), '23514');
end;
$$;

rollback;
