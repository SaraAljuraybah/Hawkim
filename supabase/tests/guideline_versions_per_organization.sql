-- Tests for 20261116200000_guideline_versions_per_organization.sql: each organization has its own GVP
-- versions, version numbers and current version; nobody edits, deletes, publishes or numbers against
-- another organization's; and publishing (by an Admin or by the compliance service) stays in the version's
-- own organization.
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

-- MedCare: the seed's GVP 4.0 (its current version), an Admin and a processed added version 5.0.
-- Other: an Admin, a published version 2.0 and an added version 3.0 being processed.
insert into auth.users (id, email, aud, role)
select ('98600000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'gvp-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 2) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
values ('98600000-0000-4000-8000-000000000001', 'Gvp Med Admin', 'gvp-1@test.invalid', 'MA', null, '+966512345601', null);
insert into public.user_roles (user_id, role) values ('98600000-0000-4000-8000-000000000001', 'admin');
insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size, created_by,
  processing_status, index_path)
values ('98600000-0000-4000-8000-0000000000d1', 'GVP', '5.0', current_date, 'https://www.sfda.gov.sa/gvp', 'gvp5.pdf',
  'files/98600000-0000-4000-8000-0000000000d1.pdf', 1, '98600000-0000-4000-8000-000000000001', 'ready', 'versions/98600000-0000-4000-8000-0000000000d1');

insert into public.organizations (id, name) values ('98600000-0000-4000-8000-0000000000aa', 'Gvp Other');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id)
values ('98600000-0000-4000-8000-000000000002', 'Gvp Other Admin', 'gvp-2@test.invalid', 'OA', null, '+966512345602', null,
  '98600000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values ('98600000-0000-4000-8000-000000000002', 'admin');
insert into public.guideline_versions (id, name, version, effective_date, file_name, organization_id, added_at)
values ('98600000-0000-4000-8000-0000000000c1', 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)', '2.0', current_date - 30, 'gvp2.pdf',
  '98600000-0000-4000-8000-0000000000aa', now() - interval '2 days');
insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size, created_by,
  processing_status, organization_id)
values ('98600000-0000-4000-8000-0000000000d2', 'GVP', '3.0', current_date, 'https://www.sfda.gov.sa/gvp', 'gvp3.pdf',
  'files/98600000-0000-4000-8000-0000000000d2.pdf', 1, '98600000-0000-4000-8000-000000000002', 'processing',
  '98600000-0000-4000-8000-0000000000aa');
set constraints all immediate;
set constraints all deferred;

do $$
declare
  other constant uuid := '98600000-0000-4000-8000-0000000000aa';
  med_admin constant uuid := '98600000-0000-4000-8000-000000000001';
  other_admin constant uuid := '98600000-0000-4000-8000-000000000002';
  med_draft constant uuid := '98600000-0000-4000-8000-0000000000d1';
  other_draft constant uuid := '98600000-0000-4000-8000-0000000000d2';
  other_version constant uuid := '98600000-0000-4000-8000-0000000000c1';
  medcare uuid := (select organization_id from public.profiles where id = '98600000-0000-4000-8000-000000000001');
  med_current uuid;
  v_new uuid;
begin
  -- ---------- The current version is per organization ----------
  assert to_regprocedure('public.current_guideline_version()') is null, 'the one current version for everybody is gone';
  med_current := public.current_guideline_version(medcare);
  assert med_current is not null and (select organization_id from public.guideline_versions where id = med_current) = medcare,
    'MedCare''s current version is its own (the seed''s GVP)';
  assert public.current_guideline_version(other) = other_version, 'Other''s current version is its 2.0';

  -- ---------- Version numbers are per organization ----------
  -- (check_new_guideline_number is internal: called as the functions that use it call it, with the owner's
  -- rights and the Admin's identity.)
  perform pg_temp.act_as(other_admin, 'postgres');
  -- MedCare has 4.0 and 5.0; for Other they are new and higher than its own current 2.0.
  perform public.check_new_guideline_number('4.0', null);
  perform public.check_new_guideline_number('5.0', null);
  perform pg_temp.expect_error($q$select public.check_new_guideline_number('2.0', null)$q$, '23505', 'version-exists');
  perform pg_temp.expect_error($q$select public.check_new_guideline_number('3.0', null)$q$, '23505', 'version-exists');
  perform pg_temp.expect_error($q$select public.check_new_guideline_number('1.5', null)$q$, '23514', 'version-not-higher');
  perform pg_temp.as_owner();
  -- The same name and number in two organizations.
  -- (Added a day ago: in this one transaction everything else is added at the same now().)
  insert into public.guideline_versions (name, version, effective_date, file_name, organization_id, added_at)
  select g.name, g.version, current_date - 60, 'copy.pdf', other, now() - interval '1 day'
  from public.guideline_versions g where g.id = med_current;

  -- ---------- MedCare's versions are "not found" for Other's Admin ----------
  perform pg_temp.act_as(other_admin);
  perform pg_temp.expect_error(format('select public.update_guideline_version(%L, %L, %L, %L)', med_current, 'Taken', current_date, 'https://www.sfda.gov.sa/x'), 'P0002');
  perform pg_temp.expect_error(format('select public.attach_guideline_file(%L, %L)', med_current, 'files/98600000-0000-4000-8000-0000000000e1.pdf'), 'P0002');
  perform pg_temp.expect_error(format('select public.update_guideline_draft(%L, %L, %L, %L, %L)', med_draft, 'Taken', '9.0', current_date, 'https://www.sfda.gov.sa/x'), 'P0002');
  perform pg_temp.expect_error(format('select public.delete_guideline_draft(%L)', med_draft), 'P0002');
  perform pg_temp.expect_error(format('select public.make_guideline_current(%L)', med_draft), 'P0002');

  -- ---------- Publishing stays in the version's organization ----------
  perform pg_temp.act_as(med_admin);
  v_new := public.make_guideline_current(med_draft);
  perform pg_temp.as_owner();
  assert (select organization_id from public.guideline_versions where id = v_new) = medcare, 'MedCare''s 5.0 is MedCare''s';
  assert public.current_guideline_version(medcare) = v_new, 'and MedCare''s current version';
  assert public.current_guideline_version(other) <> v_new, 'not Other''s';
  -- The compliance service finishing Other's 3.0.
  perform pg_temp.act_as(null, 'service_role');
  perform public.complete_guideline_processing(other_draft, 'versions/' || other_draft, '{}'::jsonb);
  perform pg_temp.as_owner();
  select id into v_new from public.guideline_versions where draft_id = other_draft;
  assert (select organization_id from public.guideline_versions where id = v_new) = other, 'Other''s 3.0 is published in Other';
  assert public.current_guideline_version(other) = v_new, 'and is Other''s current version';
  assert public.current_guideline_version(medcare) <> v_new, 'MedCare''s current version doesn''t change';
end;
$$;

rollback;
