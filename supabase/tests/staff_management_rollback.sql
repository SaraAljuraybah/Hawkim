-- Staff Management (20261110120000) checks that are safe on a SHARED project: everything below happens
-- in one transaction that ends in ROLLBACK, so no fixture, SOP code, audit row or change is kept (only
-- identity sequences may advance). Any failed assertion aborts the transaction, which also rolls back.
-- Run: supabase db query --remote -f supabase/tests/staff_management_rollback.sql
-- Covers the department transfer restriction for every responsibility, System Admin accounts, the
-- database-side field rules and bypass attempts. Two concurrent sessions are covered locally instead
-- (supabase/tests/staff_management.local.mjs).
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text, p_hint text default null) returns text
language plpgsql as $$
declare rejected boolean := false; v_hint text; v_detail text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
    if sqlstate <> p_state then raise; end if;
    assert p_hint is null or v_hint = p_hint, 'Expected hint ' || p_hint || ', got ' || coalesce(v_hint, '(none)');
    rejected := true;
  end;
  assert rejected, 'Expected ' || p_state || ' from ' || p_sql;
  return v_detail;
end;
$$;
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end; $$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end; $$;
create function pg_temp.person(p_id uuid, p_department text, p_roles text[]) returns void language plpgsql as $$
begin
  insert into auth.users(id, email, aud, role) values (p_id, 'zz-' || p_id || '@example.invalid', 'authenticated', 'authenticated');
  insert into public.profiles(id, full_name, email, initials, department_id, phone, "position")
  values (p_id, 'ZZ Test', 'zz-' || p_id || '@example.invalid', 'ZZ', p_department, '+966500000000', 'Specialist');
  insert into public.user_roles(user_id, role) select p_id, r::public.app_role from unnest(p_roles) r;
end; $$;
create function pg_temp.sop(p_author uuid, p_status public.sop_status, p_department text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.sops (id, title, department_id, author_id, status, current_version) values (v_id, 'ZZ SOP', p_department, p_author, p_status, 1);
  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values (v_id, 1, 'a.pdf', 'pdf', p_author || '/' || v_id || '.pdf', 1, p_author);
  return v_id;
end; $$;
-- save_user moving `p_user` (keeping name, phone, position and roles) to `p_to`.
create function pg_temp.move(p_user uuid, p_to text) returns text language sql as $$
  select format('select public.save_user(%L::uuid, ''ZZ Test'', ''+966500000000'', ''Specialist'', %L, %L::text[], %L, %L::text[])',
    p_user, p_to, (select coalesce(array_agg(role::text order by role::text), '{}') from public.user_roles where user_id = p_user),
    (select department_id from public.profiles where id = p_user),
    (select coalesce(array_agg(role::text order by role::text), '{}') from public.user_roles where user_id = p_user));
$$;

do $$
declare
  quality text := (select id from public.departments where is_quality and removed_at is null limit 1);
  admin uuid := gen_random_uuid(); author uuid := gen_random_uuid(); coauthor uuid := gen_random_uuid();
  reviewer uuid := gen_random_uuid(); approver uuid := gen_random_uuid(); multi uuid := gen_random_uuid();
  done uuid := gen_random_uuid(); idle uuid := gen_random_uuid(); sysadmin uuid := gen_random_uuid();
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; v_round uuid; v_detail text; v_saved jsonb;
begin
  assert quality is not null, 'No Quality department';
  insert into public.departments(id, name, initials) values ('zz-test-a', 'ZZ Test A', 'QZX'), ('zz-test-b', 'ZZ Test B', 'QZY');
  -- An admin with a department first (roles need a profile), then without one: a System Admin.
  perform pg_temp.person(admin, 'zz-test-a', '{admin}');
  update public.profiles set department_id = null, "position" = null where id = admin;
  perform pg_temp.person(author, 'zz-test-a', '{author}');
  perform pg_temp.person(coauthor, 'zz-test-a', '{author}');
  perform pg_temp.person(reviewer, 'zz-test-a', '{reviewer}');
  perform pg_temp.person(approver, quality, '{approver}');
  perform pg_temp.person(multi, 'zz-test-a', '{author,reviewer}');
  perform pg_temp.person(done, 'zz-test-a', '{author}');
  perform pg_temp.person(idle, 'zz-test-a', '{author,reviewer}');

  -- SOP work: a draft by author with coauthor; a review with reviewer pending; multi authors two and reviews one.
  s1 := pg_temp.sop(author, 'draft', 'zz-test-a');
  insert into public.sop_co_authors(sop_id, user_id, added_by) values (s1, coauthor, author);
  s2 := pg_temp.sop(multi, 'in-review', 'zz-test-a');
  insert into public.review_rounds (sop_id, version, requested_by) values (s2, 1, multi) returning id into v_round;
  insert into public.review_requests (round_id, sop_id, reviewer_id, status) values (v_round, s2, reviewer, 'pending');
  s3 := pg_temp.sop(multi, 'draft', 'zz-test-a');
  s4 := pg_temp.sop(author, 'in-review', 'zz-test-a');
  insert into public.review_rounds (sop_id, version, requested_by) values (s4, 1, author) returning id into v_round;
  insert into public.review_requests (round_id, sop_id, reviewer_id, status) values (v_round, s4, multi, 'accepted');
  perform pg_temp.sop(done, 'published', 'zz-test-a');

  perform pg_temp.act_as(admin);
  -- Author, Co-author, Reviewer: blocked, with only counts reported.
  v_detail := pg_temp.expect_error(pg_temp.move(author, 'zz-test-b'), '23514', 'department-transfer-blocked');
  assert v_detail = 'total:2,author:2', 'author: ' || v_detail;
  v_detail := pg_temp.expect_error(pg_temp.move(coauthor, 'zz-test-b'), '23514', 'department-transfer-blocked');
  assert v_detail = 'total:1,co-author:1', 'co-author: ' || v_detail;
  v_detail := pg_temp.expect_error(pg_temp.move(reviewer, 'zz-test-b'), '23514', 'department-transfer-blocked');
  assert v_detail = 'total:1,reviewer:1', 'reviewer: ' || v_detail;
  -- Several roles and several SOPs: each SOP once, every role counted.
  v_detail := pg_temp.expect_error(pg_temp.move(multi, 'zz-test-b'), '23514', 'department-transfer-blocked');
  assert v_detail = 'total:3,author:2,reviewer:1', 'multi: ' || v_detail;
  -- Completed work and no work: allowed.
  v_saved := public.save_user(done, 'ZZ Test', '+966500000000', 'Specialist', 'zz-test-b', '{author}', 'zz-test-a', '{author}');
  assert v_saved->>'departmentId' = 'zz-test-b', 'done not moved';
  v_saved := public.save_user(idle, 'ZZ Test', '+966500000000', 'Specialist', 'zz-test-b', '{author,reviewer}', 'zz-test-a', '{author,reviewer}');
  assert v_saved->>'departmentId' = 'zz-test-b', 'idle not moved';

  -- Approver: responsible while an SOP waits for approval; removing Approver in the same save doesn't help.
  perform pg_temp.as_owner();
  update public.sops set status = 'in-approval' where id = s3;
  perform pg_temp.act_as(admin);
  v_detail := pg_temp.expect_error(format('select public.save_user(%L::uuid, ''ZZ Test'', ''+966500000000'', ''Specialist'', ''zz-test-a'', ''{}''::text[], %L, ''{approver}''::text[])', approver, quality),
    '23514', 'department-transfer-blocked');
  assert v_detail like 'total:%approver:%', 'approver: ' || v_detail;

  -- Finishing the work makes the transfer possible; the blocked attempts changed nothing.
  perform pg_temp.as_owner();
  assert (select department_id from public.profiles where id = author) = 'zz-test-a', 'author moved';
  assert (select status from public.sops where id = s1) = 'draft', 'SOP status changed';
  update public.sops set status = 'published' where id in (s1, s4);
  perform pg_temp.act_as(admin);
  v_saved := public.save_user(author, 'ZZ Test', '+966500000000', 'Specialist', 'zz-test-b', '{author}', 'zz-test-a', '{author}');
  assert v_saved->>'departmentId' = 'zz-test-b', 'author not moved after publishing';

  -- Bypass attempts: a non-admin can't save staff; a direct update (even by the owner) is refused.
  perform pg_temp.act_as(reviewer);
  perform pg_temp.expect_error(pg_temp.move(reviewer, 'zz-test-b'), '42501');
  perform pg_temp.expect_error(format('update public.profiles set department_id = ''zz-test-b'' where id = %L', reviewer), '42501');
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(format('select public.sop_responsibilities_in_progress(%L)', reviewer), '42501');
  perform pg_temp.as_owner();
  perform pg_temp.expect_error(format('update public.profiles set department_id = ''zz-test-b'' where id = %L', reviewer), '23514', 'department-transfer-blocked');

  -- System Admin: created without a department or position; editing keeps it that way; staff still need both.
  insert into auth.users(id, email, aud, role) values (sysadmin, 'zz-sysadmin-' || sysadmin || '@example.invalid', 'authenticated', 'authenticated');
  perform pg_temp.act_as(admin);
  v_saved := public.add_user(sysadmin, 'zz-sysadmin-' || sysadmin || '@example.invalid', 'ZZ System Admin', '+966511111111', null, null, '{admin}');
  assert v_saved->>'departmentId' is null and v_saved->>'position' is null, 'System Admin got fields: ' || v_saved::text;
  v_saved := public.save_user(sysadmin, 'ZZ System Admin 2', '+966522222222', 'Ignored', 'zz-test-a', '{admin}', null, '{admin}');
  assert v_saved->>'departmentId' is null and v_saved->>'name' = 'ZZ System Admin 2', 'System Admin edit: ' || v_saved::text;
  perform pg_temp.expect_error($q$select public.check_new_user('zz-x@example.invalid', 'X', '+966512345678', 'P', null, '{author}')$q$, '23514', 'invalid');
  perform pg_temp.expect_error($q$select public.check_new_user('zz-x@example.invalid', 'X', '+966512345678', ' ', 'zz-test-a', '{author}')$q$, '23514', 'invalid');
  perform pg_temp.expect_error($q$select public.check_new_user('zz-x@example.invalid', 'X', '0512345678', 'P', 'zz-test-a', '{author}')$q$, '23514', 'invalid');
  perform pg_temp.expect_error($q$select public.check_new_user('zz-x@example.invalid', 'X', '+96651234567', 'P', 'zz-test-a', '{author}')$q$, '23514', 'invalid');
  perform pg_temp.expect_error($q$select public.check_new_user('not-an-email', 'X', '+966512345678', 'P', 'zz-test-a', '{author}')$q$, '23514', 'invalid');
  perform pg_temp.expect_error(format($q$select public.check_new_user(%L, 'X', '+966512345678', 'P', 'zz-test-a', '{author}')$q$,
    'zz-' || author || '@example.invalid'), '23514', 'email-taken');
  perform public.check_new_user('zz-x@example.invalid', 'X', '+966512345678', 'P', 'zz-test-a', '{author}');

  -- set_user_email: unique, and only once the sign-in account has the address.
  perform pg_temp.expect_error(format($q$select public.set_user_email(%L, %L, false)$q$, idle, 'zz-' || author || '@example.invalid'), '23514', 'email-taken');
  perform pg_temp.expect_error(format($q$select public.set_user_email(%L, 'zz-new@example.invalid', true)$q$, idle), '23514', 'invalid');
  perform pg_temp.as_owner();
  update auth.users set email = 'zz-new@example.invalid' where id = idle;
  perform pg_temp.act_as(admin);
  perform public.set_user_email(idle, 'zz-new@example.invalid', true);
  perform pg_temp.as_owner();
  assert (select email from public.profiles where id = idle) = 'zz-new@example.invalid', 'email not saved';
  raise notice 'staff_management_rollback: all checks passed';
end;
$$;

-- Deferred rules at commit time (staff need a department), then nothing is kept.
set constraints all immediate;
select 'staff_management_rollback: all checks passed' as result;
rollback;
