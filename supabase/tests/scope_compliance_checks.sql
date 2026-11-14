-- Tests for 20261116220000_scope_compliance_checks.sql: a compliance check is made against the SOP's own
-- organization's current GVP version; the sample engine (service offline) only where that version has
-- sample findings; nobody starts a check of another organization's SOP; and the compliance service is told
-- each job's organization.
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

-- The compliance service is offline (no recent heartbeat).
delete from public.compliance_service_status;

-- MedCare: an author and a draft SOP in Pharmacovigilance (compliance check required); its current GVP
-- version is the seed's, which has sample findings.
-- Other: an author and a draft SOP in its own department that requires the check; its current version
-- (2.0) has no sample findings.
insert into auth.users (id, email, aud, role)
select ('98800000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'chk-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 2) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
values ('98800000-0000-4000-8000-000000000001', 'Chk Med Author', 'chk-1@test.invalid', 'MA', 'pharmacovigilance', '+966512345601', 'Officer');
insert into public.user_roles (user_id, role) values ('98800000-0000-4000-8000-000000000001', 'author');
insert into public.sops (id, title, department_id, author_id, current_version)
values ('98800000-0000-4000-8000-0000000000b1', 'Chk Med SOP', 'pharmacovigilance', '98800000-0000-4000-8000-000000000001', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('98800000-0000-4000-8000-0000000000b1', 1, 'med.pdf', 'pdf', 'chk-test/med.pdf', 1, '98800000-0000-4000-8000-000000000001');

insert into public.organizations (id, name) values ('98800000-0000-4000-8000-0000000000aa', 'Chk Other');
insert into public.departments (id, name, initials, requires_compliance_check, organization_id)
values ('chk-other-pv', 'Pharmacovigilance', 'PV', true, '98800000-0000-4000-8000-0000000000aa');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id)
values ('98800000-0000-4000-8000-000000000002', 'Chk Other Author', 'chk-2@test.invalid', 'OA', 'chk-other-pv', '+966512345602', 'Officer',
  '98800000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values ('98800000-0000-4000-8000-000000000002', 'author');
insert into public.guideline_versions (id, name, version, effective_date, file_name, index_path, organization_id)
values ('98800000-0000-4000-8000-0000000000c1', 'GVP', '2.0', current_date, 'gvp2.pdf', 'versions/98800000-0000-4000-8000-0000000000c1',
  '98800000-0000-4000-8000-0000000000aa');
insert into public.sops (id, title, department_id, author_id, current_version)
values ('98800000-0000-4000-8000-0000000000b2', 'Chk Other SOP', 'chk-other-pv', '98800000-0000-4000-8000-000000000002', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('98800000-0000-4000-8000-0000000000b2', 1, 'other.pdf', 'pdf', 'chk-test/other.pdf', 1, '98800000-0000-4000-8000-000000000002');
set constraints all immediate;
set constraints all deferred;

do $$
declare
  other constant uuid := '98800000-0000-4000-8000-0000000000aa';
  med_author constant uuid := '98800000-0000-4000-8000-000000000001';
  other_author constant uuid := '98800000-0000-4000-8000-000000000002';
  med_sop constant uuid := '98800000-0000-4000-8000-0000000000b1';
  other_sop constant uuid := '98800000-0000-4000-8000-0000000000b2';
  other_version constant uuid := '98800000-0000-4000-8000-0000000000c1';
  medcare uuid := (select organization_id from public.sops where id = '98800000-0000-4000-8000-0000000000b1');
  v_check uuid;
  v_job record;
  v_engine text;
begin
  assert public.compliance_engine() = 'sample', 'the service is offline';

  -- ---------- MedCare: its own current version, which has sample findings: the sample engine ----------
  perform pg_temp.act_as(med_author);
  v_check := public.start_compliance_check(med_sop);
  perform pg_temp.as_owner();
  assert (select guideline_version_id = public.current_guideline_version(medcare) and engine = 'sample'
          from public.compliance_checks where id = v_check), 'MedCare''s check: its current version, the sample engine';

  -- ---------- Other: its own current version (2.0), no sample findings: waits for the service ----------
  perform pg_temp.act_as(other_author);
  v_check := public.start_compliance_check(other_sop);
  perform pg_temp.as_owner();
  assert (select guideline_version_id = other_version and engine <> 'sample' and status = 'running'
          from public.compliance_checks where id = v_check), 'Other''s check: its 2.0, waiting for the compliance service';
  assert (select organization_id from public.compliance_checks where id = v_check) = other;

  -- ---------- Nobody starts a check of another organization's SOP ----------
  perform pg_temp.act_as(other_author);
  perform pg_temp.expect_error(format('select public.start_compliance_check(%L)', med_sop), 'P0002');
  perform pg_temp.act_as(med_author);
  perform pg_temp.expect_error(format('select public.start_compliance_check(%L)', other_sop), 'P0002');

  -- ---------- The compliance service is told the job's organization ----------
  perform pg_temp.as_owner();
  v_engine := (select engine from public.compliance_checks where id = v_check);
  perform pg_temp.act_as(null, 'service_role');
  select * into v_job from public.claim_compliance_check(v_engine);
  assert v_job.check_id = v_check and v_job.organization_id = other and v_job.guideline_index_path = 'versions/' || other_version,
    'the claimed check carries Other''s organization and Other''s index';
  perform pg_temp.as_owner();
  insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size,
    created_by, processing_status, organization_id)
  values ('98800000-0000-4000-8000-0000000000d1', 'GVP', '3.0', current_date, 'https://www.sfda.gov.sa/gvp', 'gvp3.pdf',
    'files/98800000-0000-4000-8000-0000000000d1.pdf', 1, other_author, 'waiting', other);
  perform pg_temp.act_as(null, 'service_role');
  select * into v_job from public.claim_guideline_processing();
  assert v_job.id = '98800000-0000-4000-8000-0000000000d1' and v_job.organization_id = other, 'the claimed version carries its organization';
  perform pg_temp.as_owner();
  assert not has_function_privilege('authenticated', 'public.claim_compliance_check(text)', 'execute');
  assert not has_function_privilege('authenticated', 'public.claim_guideline_processing()', 'execute');
  assert has_function_privilege('service_role', 'public.claim_guideline_processing()', 'execute');
end;
$$;

rollback;
