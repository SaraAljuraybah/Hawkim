-- Tests for 20261118130000_close_compliance_check_metadata.sql. Only for a disposable LOCAL Supabase/PostgreSQL
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

insert into public.departments (id, name, initials, division_id) values ('cm-home', 'CM Home', 'CM', 'rnd');
insert into auth.users (id) values ('97900000-0000-4000-8000-000000000001');
insert into public.profiles (id, full_name, email, initials, department_id, "position")
values ('97900000-0000-4000-8000-000000000001', 'CM Author', 'cm-1@test.invalid', 'CA', 'cm-home', 'Title');
insert into public.user_roles (user_id, role) values ('97900000-0000-4000-8000-000000000001', 'author');
insert into public.guideline_versions (id, name, version, effective_date, file_name)
values ('97910000-0000-4000-8000-000000000001', 'CM guideline', '9.7', current_date, 'guideline.pdf');
insert into public.sops (id, title, department_id, author_id, status, current_version)
values ('97920000-0000-4000-8000-000000000001', 'CM SOP', 'cm-home', '97900000-0000-4000-8000-000000000001', 'draft', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('97920000-0000-4000-8000-000000000001', 1, 'v1.pdf', 'pdf', 'cm/v1.pdf', 100, '97900000-0000-4000-8000-000000000001');
insert into public.compliance_checks (id, sop_id, sop_version, guideline_version_id, status, engine, triggered_by, completed_at, metadata)
values ('97930000-0000-4000-8000-000000000001', '97920000-0000-4000-8000-000000000001', 1, '97910000-0000-4000-8000-000000000001',
        'completed', 'hawkim', '97900000-0000-4000-8000-000000000001', now(),
        '{"steps_checked": 2, "raw_results": [{"chunk_id": "S::001", "text": "Step.", "raw_output": "secret"}]}');

do $$
declare
  author constant uuid := '97900000-0000-4000-8000-000000000001';
  check_id constant uuid := '97930000-0000-4000-8000-000000000001';
  v_other text;
begin
  -- The author still reads the check (every column the website selects), but not metadata.
  perform pg_temp.act_as(author);
  assert (select c.status = 'completed' and c.engine = 'hawkim' and c.organization_id is not null
          from public.compliance_checks c where c.id = check_id), 'the other columns are readable';
  perform pg_temp.expect_error($q$select metadata from public.compliance_checks$q$, '42501');
  perform pg_temp.expect_error($q$select metadata->'steps_checked' from public.compliance_checks$q$, '42501');
  perform pg_temp.expect_error($q$select * from public.compliance_checks$q$, '42501');
  perform pg_temp.expect_error($q$select c from public.compliance_checks c$q$, '42501');
  perform pg_temp.expect_error($q$select 1 from public.compliance_checks where metadata ? 'raw_results'$q$, '42501');
  -- What the report needs still comes through the two functions.
  assert public.compliance_check_procedures(check_id)->'steps_checked' = '2'::jsonb, 'steps_checked via the function';
  assert public.compliance_check_procedures(check_id)->'procedures'->0->>'text' = 'Step.', 'procedures via the function';
  assert public.compliance_check_procedures(check_id)::text not like '%secret%', 'no raw output';

  -- Grants: every column but metadata for authenticated; nothing for anon; the service role unchanged.
  perform pg_temp.as_owner();
  assert not has_column_privilege('authenticated', 'public.compliance_checks', 'metadata', 'select'), 'metadata closed';
  assert not has_table_privilege('authenticated', 'public.compliance_checks', 'select'), 'no table-wide select';
  select string_agg(a.attname, ',') into v_other
  from pg_attribute a
  where a.attrelid = 'public.compliance_checks'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'metadata'
    and not has_column_privilege('authenticated', 'public.compliance_checks', a.attname, 'select');
  assert v_other is null, 'columns authenticated can''t read: ' || v_other;
  assert not has_any_column_privilege('anon', 'public.compliance_checks', 'select'), 'anon reads nothing';
  -- The service role's grants aren't touched (hosted gives it table grants the local stack doesn't; the
  -- compliance service only uses its functions): metadata is as readable for it as the rest of the table.
  assert has_column_privilege('service_role', 'public.compliance_checks', 'metadata', 'select')
         = has_column_privilege('service_role', 'public.compliance_checks', 'status', 'select'), 'the service role unchanged';
  assert not has_table_privilege('authenticated', 'public.compliance_checks', 'insert,update,delete'), 'still read-only';
end;
$$;

rollback;
