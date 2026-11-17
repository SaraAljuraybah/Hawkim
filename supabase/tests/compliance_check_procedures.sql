-- Tests for 20261118120000_compliance_check_procedures.sql. Only for a disposable LOCAL Supabase/PostgreSQL
-- database with every migration applied (one organization, as after `supabase db reset`); never run it
-- against the shared Supabase project. Fixtures are inserted directly; everything is rolled back.
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
-- The procedures as one comparable text: 'chunk_id|heading|page|text;…'
create function pg_temp.procedures(p_check uuid) returns text
language sql as $$
  select coalesce(string_agg(concat_ws('|', p->>'chunk_id', coalesce(p->>'heading', '∅'), coalesce(p->>'page', '∅'), coalesce(p->>'text', '∅')), ';' order by n), '')
  from jsonb_array_elements(coalesce(public.compliance_check_procedures(p_check)->'procedures', '[]')) with ordinality as x(p, n);
$$;

-- People: 1 author, 2 same department (not the author), 3 other department.
insert into public.departments (id, name, initials, division_id) values ('cp-home', 'CP Home', 'CH', 'rnd'), ('cp-other', 'CP Other', 'CO', 'rnd');
insert into auth.users (id) select ('97500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 3) n;
insert into public.profiles (id, full_name, email, initials, department_id, "position")
select ('97500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'CP Person', 'cp-' || n || '@test.invalid', 'CP',
       case when n = 3 then 'cp-other' else 'cp-home' end, 'Title'
from generate_series(1, 3) n;
insert into public.user_roles (user_id, role)
select ('97500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'author'::public.app_role from generate_series(1, 3) n;

insert into public.guideline_versions (id, name, version, effective_date, file_name)
values ('97600000-0000-4000-8000-000000000001', 'CP guideline', '9.8', current_date, 'guideline.pdf');
insert into public.sops (id, title, department_id, author_id, status, current_version)
values ('97700000-0000-4000-8000-000000000001', 'CP SOP', 'cp-home', '97500000-0000-4000-8000-000000000001', 'draft', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('97700000-0000-4000-8000-000000000001', 1, 'v1.pdf', 'pdf', 'cp/v1.pdf', 100, '97500000-0000-4000-8000-000000000001');

-- 1 a service check (raw_results sorted by result, as the service writes it); 2 a sample check;
-- 3 raw_results that isn't an array; 4 a running check; 5 a service check with odd values.
insert into public.compliance_checks (id, sop_id, sop_version, guideline_version_id, status, engine, triggered_by, completed_at, metadata)
values
  ('97800000-0000-4000-8000-000000000001', '97700000-0000-4000-8000-000000000001', 1, '97600000-0000-4000-8000-000000000001', 'completed', 'hawkim',
   '97500000-0000-4000-8000-000000000001', now(), jsonb_build_object('steps_checked', 3, 'seconds', 12.5, 'raw_results', jsonb_build_array(
     jsonb_build_object('chunk_id', 'S::010', 'heading', '10. Archive', 'page', 4, 'text', 'Step ten.', 'label', 'CONFLICT',
       'raw_output', 'secret model answer', 'requirement', jsonb_build_object('id', 'V.B.2#4', 'text', 'Req text'), 'similarity', 0.9),
     jsonb_build_object('chunk_id', 'S::002', 'heading', '2. Scope', 'page', 1, 'text', E'Step two:\n• a', 'label', 'COMPLIANT', 'justification', 'Hidden.'),
     -- Not assessed (invalid): still a procedure the service extracted.
     jsonb_build_object('chunk_id', 'S::003', 'heading', '3. Roles', 'page', 2, 'text', 'Step three.', 'valid', false, 'label', null)))),
  ('97800000-0000-4000-8000-000000000002', '97700000-0000-4000-8000-000000000001', 1, '97600000-0000-4000-8000-000000000001', 'completed', 'sample',
   '97500000-0000-4000-8000-000000000001', now(), '{}'),
  ('97800000-0000-4000-8000-000000000003', '97700000-0000-4000-8000-000000000001', 1, '97600000-0000-4000-8000-000000000001', 'completed', 'hawkim',
   '97500000-0000-4000-8000-000000000001', now(), '{"raw_results": {"chunk_id": "S::001"}, "steps_checked": "7"}'),
  ('97800000-0000-4000-8000-000000000004', '97700000-0000-4000-8000-000000000001', 1, '97600000-0000-4000-8000-000000000001', 'running', 'hawkim',
   '97500000-0000-4000-8000-000000000001', null, '{"raw_results": [{"chunk_id": "S::001", "text": "Early."}], "steps_checked": 1}'),
  ('97800000-0000-4000-8000-000000000005', '97700000-0000-4000-8000-000000000001', 1, '97600000-0000-4000-8000-000000000001', 'completed', 'hawkim',
   '97500000-0000-4000-8000-000000000001', now(), jsonb_build_object('raw_results', jsonb_build_array(
     'not an object', jsonb_build_object('heading', 'No id'), jsonb_build_object('chunk_id', ''), jsonb_build_object('chunk_id', 7),
     jsonb_build_object('chunk_id', 'no-number', 'heading', 5, 'page', '3', 'text', null),
     jsonb_build_object('chunk_id', 'T::001'))));

do $$
declare
  author constant uuid := '97500000-0000-4000-8000-000000000001';
  colleague constant uuid := '97500000-0000-4000-8000-000000000002';
  outsider constant uuid := '97500000-0000-4000-8000-000000000003';
  service_check constant uuid := '97800000-0000-4000-8000-000000000001';
  expected constant text := E'S::002|2. Scope|1|Step two:\n• a;S::003|3. Roles|2|Step three.;S::010|10. Archive|4|Step ten.';
  v_result jsonb;
  v_before text;
begin
  select md5(metadata::text) into v_before from public.compliance_checks where id = service_check;

  -- The author: every procedure in document order (the chunk_id's number, not raw_results' order),
  -- with only chunk_id, heading, page and text; and steps_checked.
  perform pg_temp.act_as(author);
  v_result := public.compliance_check_procedures(service_check);
  assert pg_temp.procedures(service_check) = expected, 'author: ' || pg_temp.procedures(service_check);
  assert v_result->'steps_checked' = '3'::jsonb, 'steps_checked: ' || v_result::text;
  assert (select array_agg(k order by k) from jsonb_object_keys(v_result) k) = array['procedures', 'steps_checked'], 'top-level keys';
  assert (select bool_and((select array_agg(k order by k) from jsonb_object_keys(p) k) = array['chunk_id', 'heading', 'page', 'text'])
          from jsonb_array_elements(v_result->'procedures') p), 'procedure keys';
  assert v_result::text not like '%secret%' and v_result::text not like '%Hidden%' and v_result::text not like '%Req text%'
     and v_result::text not like '%seconds%', 'nothing else is returned';

  -- A sample check: no procedures and no steps_checked. raw_results that isn't an array: none, and a
  -- steps_checked that isn't a number is null.
  assert public.compliance_check_procedures('97800000-0000-4000-8000-000000000002') = '{"procedures": [], "steps_checked": null}'::jsonb, 'sample check';
  assert public.compliance_check_procedures('97800000-0000-4000-8000-000000000003') = '{"procedures": [], "steps_checked": null}'::jsonb, 'raw_results not an array';
  -- Odd values: entries without a text chunk_id are left out; a heading, page or text of the wrong type is null;
  -- a chunk_id without a number comes last.
  assert pg_temp.procedures('97800000-0000-4000-8000-000000000005') = 'T::001|∅|∅|∅;no-number|∅|∅|∅',
    'odd values: ' || pg_temp.procedures('97800000-0000-4000-8000-000000000005');
  -- Nothing (null): a running check, an unknown or null id.
  assert public.compliance_check_procedures('97800000-0000-4000-8000-000000000004') is null, 'running check';
  assert public.compliance_check_procedures(gen_random_uuid()) is null, 'unknown check';
  assert public.compliance_check_procedures(null) is null, 'null id';

  -- The same access as the report: a colleague can't see a draft SOP, an outsider never can.
  perform pg_temp.act_as(colleague);
  assert public.compliance_check_procedures(service_check) is null, 'colleague, draft SOP';
  assert not exists (select 1 from public.compliance_checks c where c.id = service_check), 'report policy agrees';
  perform pg_temp.act_as(outsider);
  assert public.compliance_check_procedures(service_check) is null, 'outsider';

  -- Published: everyone in the SOP's department may see it, others still can't.
  perform pg_temp.as_owner();
  update public.sops set status = 'published' where id = '97700000-0000-4000-8000-000000000001';
  perform pg_temp.act_as(colleague);
  assert pg_temp.procedures(service_check) = expected, 'colleague, published SOP';
  perform pg_temp.act_as(outsider);
  assert public.compliance_check_procedures(service_check) is null, 'outsider, published SOP';

  -- Signed out: not allowed to call it at all.
  perform pg_temp.as_owner();
  perform set_config('role', 'anon', true);
  perform pg_temp.expect_error($q$select public.compliance_check_procedures('97800000-0000-4000-8000-000000000001')$q$, '42501');

  -- It only reads.
  perform pg_temp.as_owner();
  assert (select md5(metadata::text) from public.compliance_checks where id = service_check) = v_before, 'metadata unchanged';

  -- Definition: read-only, security definer, fixed search_path, callable by signed-in users only.
  assert (select p.provolatile = 's' and p.prosecdef and p.proconfig = array['search_path=""']
          from pg_proc p where p.oid = 'public.compliance_check_procedures(uuid)'::regprocedure), 'stable, definer, search_path';
  assert has_function_privilege('authenticated', 'public.compliance_check_procedures(uuid)', 'execute'), 'authenticated may call it';
  assert not has_function_privilege('anon', 'public.compliance_check_procedures(uuid)', 'execute'), 'anon may not';
  assert not has_function_privilege('service_role', 'public.compliance_check_procedures(uuid)', 'execute'), 'service_role may not';
end;
$$;

rollback;
