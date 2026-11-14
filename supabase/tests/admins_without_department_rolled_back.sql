-- Step 6 of the 20261112140000 tests (see admins_without_department_before.sql), right after
-- supabase/scripts/rollback_admins_without_department.sql: everything is as before the migration.
-- Disposable LOCAL database only; rolled back.
begin;
set local plpgsql.check_asserts = on;

do $$
declare
  sa constant uuid := '9e000000-0000-4000-8000-000000000001';
  two constant uuid := '9e000000-0000-4000-8000-000000000002';
  bare constant uuid := '9e000000-0000-4000-8000-000000000003';
  clear constant uuid := '9e000000-0000-4000-8000-000000000004';
  rejected boolean := false;
  v_constraint text;
begin
  -- The exact old values.
  assert (select department_id = 'aw-it' and "position" = 'IT' from public.profiles where id = sa), 'the Super Admin restored';
  assert (select department_id = 'aw-it' and "position" = 'Systems Lead' from public.profiles where id = two), 'restored';
  assert (select department_id = 'aw-it' and "position" is null from public.profiles where id = bare), 'a department without a position, as before';
  assert (select department_id is null and "position" is null from public.profiles where id = clear), 'never changed';
  assert (select array_agg(title || ':' || sort_order order by title) from public.employee_positions where profile_id = two)
    = array['Backup Lead:5', 'Systems Lead:0'], 'both position rows, in their order';
  assert (select array_agg(title) from public.employee_positions where profile_id = sa) = array['IT'], 'the Super Admin''s row';
  assert not exists (select 1 from public.employee_positions where profile_id = bare), 'none where there was none';
  assert (select user_id = sa from public.super_admin), 'still the Super Admin';
  -- The rules hold for the restored state at commit (checked now).
  set constraints all immediate;

  -- Nothing left behind.
  assert to_regclass('public.admin_profile_backup') is null, 'backup dropped';

  -- Request Hawkim: the request without a position is kept; new ones need a position again.
  assert (select job_title is null from public.access_requests where email = 'aw-kept@test.invalid'), 'kept as it is';
  assert (select not convalidated from pg_constraint where conname = 'access_requests_job_title_check'), 'the rule applies to new rows';
  begin
    perform public.submit_access_request('AW After Pharma', 'After Applicant', null, 'aw-after@test.invalid', '+966500000006', 5, null, repeat('8', 64));
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    rejected := v_constraint = 'access_requests_job_title_check';
  end;
  assert rejected, 'a position is required again (refused by the position rule)';
  -- accept_access_request: the earlier body (a department, the request's position).
  assert pg_get_functiondef('public.accept_access_request(uuid, text, uuid, text)'::regprocedure) like '%department_not_found%', 'the earlier accept body';
  assert pg_get_functiondef('public.accept_access_request(uuid, text, uuid, text)'::regprocedure) like '%request.job_title%';
end;
$$;

rollback;
