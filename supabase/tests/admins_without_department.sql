-- Tests for 20261112140000_admins_without_department.sql, after admins_without_department_before.sql and
-- the migration (see that file for the order). Only for a disposable LOCAL database; never the shared
-- project. Everything here is rolled back.
begin;
set local plpgsql.check_asserts = on;

-- Expects the statement to fail with this SQLSTATE and, when given, this hint.
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
-- The deferred rules, checked now (as at commit), inside a subtransaction the caller can catch.
create function pg_temp.staff_without_department() returns void language plpgsql as $$
begin
  insert into auth.users (id, email) values ('9e000000-0000-4000-8000-0000000000a1', 'aw-new-staff@test.invalid');
  insert into public.profiles (id, full_name, email, initials) values ('9e000000-0000-4000-8000-0000000000a1', 'AW New Staff', 'aw-new-staff@test.invalid', 'NS');
  insert into public.user_roles (user_id, role) values ('9e000000-0000-4000-8000-0000000000a1', 'author');
  set constraints all immediate;
end;
$$;
create function pg_temp.staff_last_position_removed() returns void language plpgsql as $$
begin
  delete from public.employee_positions where profile_id = '9e000000-0000-4000-8000-000000000006';
  set constraints all immediate;
end;
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(),
  pg_temp.staff_without_department(), pg_temp.staff_last_position_removed() to public;

do $$
declare
  sa constant uuid := '9e000000-0000-4000-8000-000000000001';
  two constant uuid := '9e000000-0000-4000-8000-000000000002';
  bare constant uuid := '9e000000-0000-4000-8000-000000000003';
  clear constant uuid := '9e000000-0000-4000-8000-000000000004';
  ended constant uuid := '9e000000-0000-4000-8000-000000000005';
  staff constant uuid := '9e000000-0000-4000-8000-000000000006';
  applicant constant uuid := '9e000000-0000-4000-8000-0000000000b1';
  v_backup public.admin_profile_backup;
  v_request uuid;
  v_profile public.profiles;
  v_constraint text;
begin
  -- ---------- Every active Admin: no department, no position, no position rows ----------
  assert (select count(*) from public.profiles where id in (sa, two, bare, clear) and (department_id is not null or "position" is not null)) = 0, 'Admins cleared';
  assert not exists (select 1 from public.employee_positions where profile_id in (sa, two, bare, clear)), 'their position rows removed';
  -- Not touched: a deactivated Admin, and staff.
  assert (select department_id = 'aw-it' and "position" = 'Former Lead' from public.profiles where id = ended), 'a deactivated Admin stays as is';
  assert (select department_id = 'aw-ops' and "position" = 'Specialist' from public.profiles where id = staff), 'staff unchanged';
  assert exists (select 1 from public.employee_positions where profile_id = staff and title = 'Specialist'), 'staff positions unchanged';

  -- ---------- The backup holds the exact old values, only for those changed ----------
  assert (select array_agg(profile_id order by profile_id) from public.admin_profile_backup) = array[sa, two, bare], 'only the changed Admins';
  select * into v_backup from public.admin_profile_backup where profile_id = two;
  assert v_backup.department_id = 'aw-it' and v_backup."position" = 'Systems Lead', 'department and position saved';
  assert jsonb_array_length(v_backup.positions) = 2, 'both position rows saved';
  assert (select x.sort_order from jsonb_to_recordset(v_backup.positions) as x(title text, sort_order integer) where x.title = 'Backup Lead') = 5, 'with their order';
  select * into v_backup from public.admin_profile_backup where profile_id = bare;
  assert v_backup.department_id = 'aw-it' and v_backup."position" is null and v_backup.positions = '[]', 'a department without a position';
  assert not has_table_privilege('authenticated', 'public.admin_profile_backup', 'select'), 'the backup is closed';
  assert not has_table_privilege('service_role', 'public.admin_profile_backup', 'select');
  assert (select relrowsecurity from pg_class where oid = 'public.admin_profile_backup'::regclass), 'RLS on';

  -- ---------- The deferred rules still hold for everyone else ----------
  -- Admins pass "staff need a department" at commit (checked now).
  set constraints all immediate;
  -- Staff without a department are still refused at commit.
  perform pg_temp.expect_error('select pg_temp.staff_without_department()', '23514', 'department-required');
  -- employee_positions triggers: a position must be in the person's department; staff keep at least one.
  perform pg_temp.expect_error(format($q$insert into public.employee_positions (profile_id, department_id, title) values (%L, 'aw-it', 'Elsewhere')$q$, staff), '23514');
  perform pg_temp.expect_error('select pg_temp.staff_last_position_removed()', '23514');
  -- An Admin can't be given a position row (no department).
  perform pg_temp.expect_error(format($q$insert into public.employee_positions (profile_id, department_id, title) values (%L, 'aw-it', 'Lead')$q$, two), '23514');

  -- ---------- Super Admin protections are unchanged ----------
  assert (select user_id = sa from public.super_admin), 'still the Super Admin';
  assert (select deleted_at is null from public.profiles where id = sa), 'not ended';
  perform pg_temp.act_as(two);
  perform pg_temp.expect_error(format('select public.update_admin(%L, %L, %L)', sa, 'Hijacked', '+966512345699'), '42501', 'super-admin-protected');
  perform pg_temp.as_owner();
  perform pg_temp.expect_error(format('update public.profiles set deleted_at = now() where id = %L', sa), '23514', 'super-admin-protected');

  -- ---------- SOP-related checks: why the migration checks for SOP work first ----------
  -- An Admin with a department and an SOP in progress can't have it cleared (the transfer guard).
  -- Back to checking at commit (as in a real request), so the position row is added before it is checked.
  set constraints all deferred;
  update public.profiles set department_id = 'aw-ops', "position" = 'Ops Lead' where id = clear;
  insert into public.sops (id, title, department_id, author_id, current_version)
  values ('9e000000-0000-4000-8000-0000000000c1', 'AW SOP in progress', 'aw-ops', clear, 1);
  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values ('9e000000-0000-4000-8000-0000000000c1', 1, 'a.pdf', 'pdf', 'aw/a.pdf', 1, clear);
  perform pg_temp.expect_error(format('update public.profiles set department_id = null where id = %L', clear), '23514', 'department-transfer-blocked');

  -- ---------- Request Hawkim: no position needed; an old request keeps its own ----------
  assert (select job_title = 'QPPV' from public.access_requests where email = 'aw-old@test.invalid'), 'existing rows unchanged';
  v_request := public.submit_access_request('AW New Pharma', 'New Applicant', null, 'aw-new@test.invalid', '+966500000001', 5, null, repeat('d', 64));
  assert (select job_title is null from public.access_requests where id = v_request), 'no position: null';
  v_request := public.submit_access_request('AW Blank Pharma', 'Blank Applicant', '   ', 'aw-blank@test.invalid', '+966500000002', 5, null, repeat('e', 64));
  assert (select job_title is null from public.access_requests where id = v_request), 'a blank position: null';
  v_request := public.submit_access_request('AW Titled Pharma', 'Titled Applicant', ' QPPV ', 'aw-titled@test.invalid', '+966500000003', 5, null, repeat('f', 64));
  assert (select job_title = 'QPPV' from public.access_requests where id = v_request), 'a position sent by an older form: trimmed and kept';
  -- Too long: refused by the position rule itself (the token hash is valid).
  begin
    perform public.submit_access_request('AW Long Pharma', 'Long', repeat('x', 101), 'aw-long@test.invalid', '+966500000004', 5, null, repeat('b', 64));
    assert false, 'a 101-character position is refused';
  exception when check_violation then
    get stacked diagnostics v_constraint = constraint_name;
    assert v_constraint = 'access_requests_job_title_check', 'refused by ' || coalesce(v_constraint, '?');
  end;

  -- ---------- Accepting a request: the Super Admin has no department and no position ----------
  -- A new deployment: no Super Admin and no active Admin (rolled back).
  alter table public.super_admin disable trigger user;
  delete from public.super_admin;
  alter table public.super_admin enable trigger user;
  update public.profiles p set deleted_at = now()
  where p.deleted_at is null and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin');
  insert into auth.users (id, email) values (applicant, 'aw-titled@test.invalid');
  -- The department sent by the deployed Edge Function is ignored, even one that doesn't exist.
  perform public.accept_access_request(v_request, repeat('f', 64), applicant, 'no-such-department');
  select * into v_profile from public.profiles where id = applicant;
  assert v_profile.department_id is null and v_profile."position" is null, 'no department, no position (not even the request''s)';
  assert v_profile.full_name = 'Titled Applicant' and v_profile.phone = '+966500000003', 'the rest as before';
  assert (select array_agg(role::text) from public.user_roles where user_id = applicant) = array['admin'], 'an Admin only';
  assert (select user_id = applicant from public.super_admin), 'the Super Admin';
  assert (select status = 'accepted' and user_id = applicant from public.access_requests where id = v_request), 'accepted';
  set constraints all immediate;
  -- A deployment that has its Super Admin accepts no other request.
  perform pg_temp.expect_error(format('select public.accept_access_request(%L, %L, %L, null)',
    (select id from public.access_requests where email = 'aw-new@test.invalid'), repeat('d', 64), applicant), 'P0001');
end;
$$;

rollback;
