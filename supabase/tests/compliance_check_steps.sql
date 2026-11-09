-- Tests for 20261108130000_compliance_check_steps.sql. Only for a disposable LOCAL Supabase/PostgreSQL
-- database with every migration applied; never run it against the shared Supabase project. Fixtures
-- are inserted directly; everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text) returns void
language plpgsql as $$
declare v_rejected boolean := false;
begin
  begin execute p_sql;
  exception when others then
    if sqlstate <> p_state then raise; end if;
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
-- The function's rows as one comparable text: 'code|chunk_id|text;…'
create function pg_temp.steps(p_check uuid) returns text
language sql as $$
  select coalesce(string_agg(concat_ws('|', s.code, s.chunk_id, s.text), ';'), '') from public.compliance_check_steps(p_check) s;
$$;

-- People: 1 author, 2 same department (not the author), 3 other department.
insert into public.departments (id, name, initials) values ('cs-home', 'CS Home', 'CH'), ('cs-other', 'CS Other', 'CO');
insert into auth.users (id) select ('97000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 3) n;
insert into public.profiles (id, full_name, email, initials, department_id, "position")
select ('97000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'CS Person', 'cs-' || n || '@test.invalid', 'CP',
       case when n = 3 then 'cs-other' else 'cs-home' end, 'Title'
from generate_series(1, 3) n;
insert into public.user_roles (user_id, role)
select ('97000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'author'::public.app_role from generate_series(1, 3) n;

insert into public.guideline_versions (id, name, version, effective_date, file_name)
values ('97100000-0000-4000-8000-000000000001', 'CS guideline', '9.9', current_date, 'guideline.pdf');
insert into public.sops (id, title, department_id, author_id, status, current_version)
values ('97200000-0000-4000-8000-000000000001', 'CS SOP', 'cs-home', '97000000-0000-4000-8000-000000000001', 'draft', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('97200000-0000-4000-8000-000000000001', 1, 'v1.pdf', 'pdf', 'cs/v1.pdf', 100, '97000000-0000-4000-8000-000000000001');

-- 1 a service check whose raw_results has every kind of step; 2 a sample check (no raw_results);
-- 3 raw_results that isn't an array; 4 a running check.
insert into public.compliance_checks (id, sop_id, sop_version, guideline_version_id, status, engine, triggered_by, completed_at, metadata)
values
  ('97300000-0000-4000-8000-000000000001', '97200000-0000-4000-8000-000000000001', 1, '97100000-0000-4000-8000-000000000001', 'completed', 'hawkim',
   '97000000-0000-4000-8000-000000000001', now(), jsonb_build_object('steps_checked', 10, 'raw_results', jsonb_build_array(
     jsonb_build_object('chunk_id', 'S::001', 'text', 'Step one.', 'valid', true, 'label', 'COMPLIANT',
       'requirement', jsonb_build_object('id', 'V.B.2#4', 'section', 'V.B.2', 'text', 'Req'), 'raw_output', 'secret model answer', 'similarity', 0.9),
     -- Left out, as aggregate.py does: not valid, no label, empty label, no requirement, empty requirement.
     jsonb_build_object('chunk_id', 'S::002', 'text', 'Invalid.', 'valid', false, 'label', null, 'requirement', jsonb_build_object('id', 'V.B.2#4')),
     jsonb_build_object('chunk_id', 'S::003', 'text', 'No label.', 'valid', true, 'label', null, 'requirement', jsonb_build_object('id', 'V.B.2#4')),
     jsonb_build_object('chunk_id', 'S::004', 'text', 'Empty label.', 'valid', true, 'label', '', 'requirement', jsonb_build_object('id', 'V.B.2#4')),
     jsonb_build_object('chunk_id', 'S::005', 'text', 'No requirement.', 'valid', true, 'label', 'PARTIAL', 'requirement', null),
     jsonb_build_object('chunk_id', 'S::006', 'text', 'Empty requirement.', 'valid', true, 'label', 'PARTIAL', 'requirement', '{}'::jsonb),
     jsonb_build_object('chunk_id', 'S::007', 'text', 'Missing keys.'),
     -- Each decided by one rule alone: not valid (with a label), and a requirement without an id.
     jsonb_build_object('chunk_id', 'S::011', 'text', 'Invalid with label.', 'valid', false, 'label', 'PARTIAL', 'requirement', jsonb_build_object('id', 'V.B.2#4')),
     jsonb_build_object('chunk_id', 'S::012', 'text', 'Requirement without id.', 'valid', true, 'label', 'PARTIAL', 'requirement', jsonb_build_object('section', 'V.B.2')),
     jsonb_build_object('chunk_id', 'S::013', 'text', 'Valid as text.', 'valid', 'true', 'label', 'PARTIAL', 'requirement', jsonb_build_object('id', 'V.B.2#4')),
     -- Kept, with the same code as step 1 (one finding with two steps) and another code.
     jsonb_build_object('chunk_id', 'S::008', 'text', E'Step eight:\n• a\n• b', 'valid', true, 'label', 'CONFLICT',
       'requirement', jsonb_build_object('id', 'V.B.2#4')),
     jsonb_build_object('chunk_id', 'S::009', 'text', 'Step nine.', 'valid', true, 'label', 'NOT_ADDRESSED',
       'requirement', jsonb_build_object('id', 'VII.C.1#2')),
     -- A similar but different code is its own group (codes are matched exactly).
     jsonb_build_object('chunk_id', 'S::010', 'text', 'Step ten.', 'valid', true, 'label', 'PARTIAL',
       'requirement', jsonb_build_object('id', 'V.B.2#40'))))),
  ('97300000-0000-4000-8000-000000000002', '97200000-0000-4000-8000-000000000001', 1, '97100000-0000-4000-8000-000000000001', 'completed', 'sample',
   '97000000-0000-4000-8000-000000000001', now(), '{}'),
  ('97300000-0000-4000-8000-000000000003', '97200000-0000-4000-8000-000000000001', 1, '97100000-0000-4000-8000-000000000001', 'completed', 'hawkim',
   '97000000-0000-4000-8000-000000000001', now(), '{"raw_results": {"chunk_id": "S::001"}}'),
  ('97300000-0000-4000-8000-000000000004', '97200000-0000-4000-8000-000000000001', 1, '97100000-0000-4000-8000-000000000001', 'running', 'hawkim',
   '97000000-0000-4000-8000-000000000001', null,
   '{"raw_results": [{"chunk_id": "S::001", "text": "Early.", "valid": true, "label": "COMPLIANT", "requirement": {"id": "R1"}}]}');

do $$
declare
  author constant uuid := '97000000-0000-4000-8000-000000000001';
  colleague constant uuid := '97000000-0000-4000-8000-000000000002';
  outsider constant uuid := '97000000-0000-4000-8000-000000000003';
  service_check constant uuid := '97300000-0000-4000-8000-000000000001';
  expected constant text := 'V.B.2#4|S::001|Step one.;' || E'V.B.2#4|S::008|Step eight:\n• a\n• b;' || 'VII.C.1#2|S::009|Step nine.;V.B.2#40|S::010|Step ten.';
  v_before text;
  v_columns text;
begin
  select md5(metadata::text) into v_before from public.compliance_checks where id = service_check;

  -- The author: only the steps behind findings, in document order, with only code, chunk_id and text.
  perform pg_temp.act_as(author);
  assert pg_temp.steps(service_check) = expected, 'author: ' || pg_temp.steps(service_check);
  select string_agg(a, ',' order by n) into v_columns
  from unnest((select proargnames from pg_proc where oid = 'public.compliance_check_steps(uuid)'::regprocedure)) with ordinality as x(a, n);
  assert v_columns = 'p_check_id,code,chunk_id,text', 'columns: ' || v_columns;
  assert pg_temp.steps(service_check) not like '%secret%' and pg_temp.steps(service_check) not like '%Invalid%', 'nothing else is returned';
  -- One finding's steps: exactly the steps with its code.
  assert (select string_agg(s.chunk_id, ',') from public.compliance_check_steps(service_check) s where s.code = 'V.B.2#4') = 'S::001,S::008', 'V.B.2#4 steps';
  assert (select string_agg(s.chunk_id, ',') from public.compliance_check_steps(service_check) s where s.code = 'V.B.2#40') = 'S::010', 'V.B.2#40 steps';
  -- No steps: a sample check, raw_results that isn't an array, a running check, an unknown or null id.
  assert pg_temp.steps('97300000-0000-4000-8000-000000000002') = '', 'sample check';
  assert pg_temp.steps('97300000-0000-4000-8000-000000000003') = '', 'raw_results not an array';
  assert pg_temp.steps('97300000-0000-4000-8000-000000000004') = '', 'running check';
  assert pg_temp.steps(gen_random_uuid()) = '', 'unknown check';
  assert pg_temp.steps(null) = '', 'null id';

  -- The same access as the report: a colleague can't see a draft SOP, an outsider never can.
  perform pg_temp.act_as(colleague);
  assert pg_temp.steps(service_check) = '', 'colleague, draft SOP';
  assert not exists (select 1 from public.compliance_findings f where f.check_id = service_check), 'report policy agrees';
  perform pg_temp.act_as(outsider);
  assert pg_temp.steps(service_check) = '', 'outsider';

  -- Published: everyone in the SOP's department may see it, others still can't.
  perform pg_temp.as_owner();
  update public.sops set status = 'published' where id = '97200000-0000-4000-8000-000000000001';
  perform pg_temp.act_as(colleague);
  assert pg_temp.steps(service_check) = expected, 'colleague, published SOP';
  perform pg_temp.act_as(outsider);
  assert pg_temp.steps(service_check) = '', 'outsider, published SOP';

  -- Signed out: not allowed to call it at all.
  perform pg_temp.as_owner();
  perform set_config('role', 'anon', true);
  perform pg_temp.expect_error($q$select * from public.compliance_check_steps('97300000-0000-4000-8000-000000000001')$q$, '42501');

  -- It only reads.
  perform pg_temp.as_owner();
  assert (select md5(metadata::text) from public.compliance_checks where id = service_check) = v_before, 'metadata unchanged';

  -- Definition: read-only, security definer, fixed search_path, callable by signed-in users only.
  assert (select p.provolatile = 's' and p.prosecdef and p.proconfig = array['search_path=""']
          from pg_proc p where p.oid = 'public.compliance_check_steps(uuid)'::regprocedure), 'stable, definer, search_path';
  assert has_function_privilege('authenticated', 'public.compliance_check_steps(uuid)', 'execute'), 'authenticated may call it';
  assert not has_function_privilege('anon', 'public.compliance_check_steps(uuid)', 'execute'), 'anon may not';
  assert not has_function_privilege('service_role', 'public.compliance_check_steps(uuid)', 'execute'), 'service_role may not';
end;
$$;

rollback;
