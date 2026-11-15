-- Tests for 20261120130000_guideline_availability.sql, and for start_compliance_check without a guideline:
-- a new organization has no guideline; guideline_availability() tells its users why no check can run (none,
-- processing, failed, cancelled, unpublished) and 'available' once a version is published; the database refuses a
-- check until then, and a check uses its own organization's current version.
-- Only for a disposable LOCAL database with every migration and the seed applied. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text) returns void
language plpgsql as $$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    assert v_state = p_state, format('Expected %s from %s, got %s (%s)', p_state, p_sql, v_state, sqlerrm);
    return;
  end;
  assert false, 'Expected ' || p_state || ' from ' || p_sql;
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
-- What the user is told, as that user.
create function pg_temp.availability(p_user uuid) returns text
language plpgsql as $$
declare v text;
begin
  perform pg_temp.act_as(p_user);
  v := public.guideline_availability();
  perform pg_temp.as_owner();
  return v;
end;
$$;
grant execute on function pg_temp.expect_error(text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(), pg_temp.availability(uuid) to public;

-- A new organization (Request Hawkim, accepted), with an Admin and an Author in its Pharmacovigilance department.
insert into public.access_requests (id, organization, contact_name, email, phone, approx_users, review_token_hash, review_expires_at)
values ('9c000000-0000-4000-8000-0000000000a1', 'GA New Pharma', 'GA Admin', 'ga-admin@test.invalid', '+966500000011', 10, repeat('3', 64), now() + interval '1 day');
insert into auth.users (id, email, aud, role) values
  ('9c000000-0000-4000-8000-000000000001', 'ga-admin@test.invalid', 'authenticated', 'authenticated'),
  ('9c000000-0000-4000-8000-000000000002', 'ga-author@test.invalid', 'authenticated', 'authenticated'),
  ('9c000000-0000-4000-8000-000000000003', 'ga-medcare@test.invalid', 'authenticated', 'authenticated');
select pg_temp.act_as(null, 'service_role');
select public.accept_access_request('9c000000-0000-4000-8000-0000000000a1', repeat('3', 64), '9c000000-0000-4000-8000-000000000001', null);
select pg_temp.as_owner();
create temporary table ga on commit drop as
select p.organization_id as org,
  (select d.id from public.departments d where d.organization_id = p.organization_id and d.system_key = 'pharmacovigilance') as pv,
  (select o.id from public.organizations o where o.access_request_id is null order by o.created_at, o.id limit 1) as medcare
from public.profiles p where p.id = '9c000000-0000-4000-8000-000000000001';
grant select on ga to public;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id)
select '9c000000-0000-4000-8000-000000000002', 'GA Author', 'ga-author@test.invalid', 'GU', g.pv, '+966500000012', 'Officer', g.org from ga g;
insert into public.user_roles (user_id, role) values ('9c000000-0000-4000-8000-000000000002', 'author');
-- A MedCare author, for comparison.
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id)
select '9c000000-0000-4000-8000-000000000003', 'GA MedCare Author', 'ga-medcare@test.invalid', 'GM', 'pharmacovigilance', '+966500000013', 'Officer', g.medcare
from ga g;
insert into public.user_roles (user_id, role) values ('9c000000-0000-4000-8000-000000000003', 'author');
-- The author's SOP, a draft with one version, in the department that requires a compliance check.
insert into public.sops (id, title, department_id, author_id, current_version)
select '9c000000-0000-4000-8000-0000000000b1', 'GA SOP', g.pv, '9c000000-0000-4000-8000-000000000002', 1 from ga g;
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
select '9c000000-0000-4000-8000-0000000000b1', 1, 'ga.pdf', 'pdf', g.org::text || '/9c000000-0000-4000-8000-000000000002/ga.pdf', 1,
  '9c000000-0000-4000-8000-000000000002' from ga g;
insert into public.sops (id, title, department_id, author_id, current_version)
values ('9c000000-0000-4000-8000-0000000000b2', 'GA MedCare SOP', 'pharmacovigilance', '9c000000-0000-4000-8000-000000000003', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
select '9c000000-0000-4000-8000-0000000000b2', 1, 'gm.pdf', 'pdf', g.medcare::text || '/9c000000-0000-4000-8000-000000000003/gm.pdf', 1,
  '9c000000-0000-4000-8000-000000000003' from ga g;

do $$
declare
  g record;
  author constant uuid := '9c000000-0000-4000-8000-000000000002';
  admin constant uuid := '9c000000-0000-4000-8000-000000000001';
  medcare_author constant uuid := '9c000000-0000-4000-8000-000000000003';
  v_check uuid; v_version uuid;
  start_sql constant text := 'select public.start_compliance_check(''9c000000-0000-4000-8000-0000000000b1'')';
  medcare_reports bigint := (select count(*) from public.compliance_checks);
begin
  select * into g from ga;
  assert has_function_privilege('authenticated', 'public.guideline_availability()', 'execute');
  assert not has_function_privilege('anon', 'public.guideline_availability()', 'execute');

  -- ---------- No guideline at all ----------
  assert not exists (select 1 from public.guideline_versions where organization_id = g.org), 'the new organization has no version';
  assert pg_temp.availability(author) = 'none', 'none';
  assert pg_temp.availability(admin) = 'none', 'the Admin is told the same';
  assert pg_temp.availability(medcare_author) = 'available', 'MedCare has its version';
  -- No check starts, and none is recorded; the SOP is unchanged.
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(start_sql, 'P0002');
  perform pg_temp.as_owner();
  assert not exists (select 1 from public.compliance_checks where sop_id = '9c000000-0000-4000-8000-0000000000b1'), 'no check recorded';
  assert (select status = 'draft' and current_version = 1 from public.sops where id = '9c000000-0000-4000-8000-0000000000b1');
  -- Uploading a new version still works without a guideline.
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('sop-files', g.org::text || '/' || author || '/9c000000-0000-4000-8000-0000000000f2.pdf', author,
    '{"mimetype": "application/pdf", "size": 1}');
  perform pg_temp.act_as(author);
  perform public.upload_sop_version('9c000000-0000-4000-8000-0000000000b1',
    g.org::text || '/' || author || '/9c000000-0000-4000-8000-0000000000f2.pdf', 'v2.pdf');
  perform pg_temp.as_owner();
  assert (select current_version = 2 and status = 'draft' from public.sops where id = '9c000000-0000-4000-8000-0000000000b1'),
    'a new version is uploaded without any guideline';

  -- ---------- An added version, each processing state ----------
  insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size, created_by,
    processing_status, organization_id)
  values ('9c000000-0000-4000-8000-0000000000d1', 'GA GVP', '1.0', current_date, 'https://www.sfda.gov.sa/gvp', 'ga-gvp.pdf',
    g.org::text || '/files/9c000000-0000-4000-8000-0000000000d1.pdf', 1, admin, 'waiting', g.org);
  assert pg_temp.availability(author) = 'processing', 'waiting counts as processing';
  update public.guideline_version_drafts set processing_status = 'processing', processing_started_at = now() where id = '9c000000-0000-4000-8000-0000000000d1';
  assert pg_temp.availability(author) = 'processing', 'processing';
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(start_sql, 'P0002');
  perform pg_temp.as_owner();
  update public.guideline_version_drafts set cancel_requested = true where id = '9c000000-0000-4000-8000-0000000000d1';
  assert pg_temp.availability(author) = 'cancelled', 'being cancelled';
  update public.guideline_version_drafts set cancel_requested = false, processing_status = 'failed', processing_error = 'x'
  where id = '9c000000-0000-4000-8000-0000000000d1';
  assert pg_temp.availability(author) = 'failed', 'failed';
  update public.guideline_version_drafts set processing_status = 'ready', processing_error = null, processed_at = now()
  where id = '9c000000-0000-4000-8000-0000000000d1';
  assert pg_temp.availability(author) = 'unpublished', 'processed, not published';
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(start_sql, 'P0002');
  perform pg_temp.as_owner();
  assert public.current_guideline_version(g.org) is null, 'an unpublished version is never made current';
  -- A failed one and a new one in the queue: the one in the queue is what the user is told about.
  update public.guideline_version_drafts set processing_status = 'failed', processed_at = null, processing_error = 'x'
  where id = '9c000000-0000-4000-8000-0000000000d1';
  insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size, created_by,
    processing_status, organization_id)
  values ('9c000000-0000-4000-8000-0000000000d2', 'GA GVP', '1.1', current_date, 'https://www.sfda.gov.sa/gvp', 'ga-gvp2.pdf',
    g.org::text || '/files/9c000000-0000-4000-8000-0000000000d2.pdf', 1, admin, 'waiting', g.org);
  assert pg_temp.availability(author) = 'processing', 'the version in the queue wins';
  assert not exists (select 1 from public.compliance_checks where sop_id = '9c000000-0000-4000-8000-0000000000b1'), 'still no check recorded';

  -- ---------- Published: the check runs, against this organization's version ----------
  insert into public.guideline_versions (id, name, version, effective_date, file_name, index_path, organization_id)
  values ('9c000000-0000-4000-8000-0000000000c1', 'GA GVP', '1.0', current_date, 'ga-gvp.pdf',
    g.org::text || '/versions/9c000000-0000-4000-8000-0000000000c1', g.org);
  assert pg_temp.availability(author) = 'available', 'available once published, even with a version in the queue';
  perform pg_temp.act_as(author);
  v_check := public.start_compliance_check('9c000000-0000-4000-8000-0000000000b1');
  perform pg_temp.as_owner();
  select guideline_version_id into v_version from public.compliance_checks where id = v_check;
  assert v_version = '9c000000-0000-4000-8000-0000000000c1', 'checked against its own organization''s version';
  assert (select organization_id from public.compliance_checks where id = v_check) = g.org;
  -- MedCare's check uses MedCare's version, never the new organization's.
  perform pg_temp.act_as(medcare_author);
  v_check := public.start_compliance_check('9c000000-0000-4000-8000-0000000000b2');
  perform pg_temp.as_owner();
  assert (select guideline_version_id from public.compliance_checks where id = v_check) = public.current_guideline_version(g.medcare)
    and public.current_guideline_version(g.medcare) <> '9c000000-0000-4000-8000-0000000000c1', 'MedCare uses its own';
  assert (select count(*) from public.compliance_checks) = medcare_reports + 2, 'only the two new checks were added';

  -- ---------- Only active users of the organization ----------
  perform pg_temp.act_as(gen_random_uuid());
  perform pg_temp.expect_error('select public.guideline_availability()', '42501');
  perform pg_temp.as_owner();
  update public.profiles set deleted_at = now() where id = author;
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error('select public.guideline_availability()', '42501');
  perform pg_temp.as_owner();
end;
$$;

rollback;
