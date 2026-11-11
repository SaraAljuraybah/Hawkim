-- Tests for 20261113130000_staff_reactivation.sql: Reactivate on the Deactive Staff tab (reactivate_staff)
-- brings back the SAME deactivated staff member with the permissions, department and history they had,
-- and Edit Staff edits a deactivated staff member without reactivating them. Every call is made as the API
-- would make it (role authenticated or anon, with the caller's id in the JWT claims).
-- Only for a disposable LOCAL database with every migration applied; never the shared project.
-- Everything is rolled back.
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
create function pg_temp.roles(p_user uuid) returns text[]
language sql as $$
  select coalesce(array_agg(r.role::text order by r.role::text), '{}') from public.user_roles r where r.user_id = p_user;
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(), pg_temp.roles(uuid) to public;

-- People: 1 Admin (the caller), 2 deactivated author+reviewer, 3 deactivated staff whose department was removed,
-- 4 deactivated staff whose email is now someone else's, 5 active staff, 6 a deactivated Admin, 7 the Super Admin,
-- 8 active staff now using 4's email, 9 deactivated staff whose sign-in account is blocked.
insert into auth.users (id, email, aud, role)
select ('98000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'sr-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 9) n;
update auth.users set banned_until = now() + interval '1 day' where id = '98000000-0000-4000-8000-000000000009';
insert into public.departments (id, name, initials) values ('sr-home', 'SR Home', 'SH'), ('sr-gone', 'SR Gone', 'SG');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
select ('98000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'SR Person ' || n, 'sr-' || n || '@test.invalid', 'SP',
  case when n = 3 then 'sr-gone' else 'sr-home' end, '+96651234561' || (n % 10), 'Officer'
from generate_series(1, 9) n;
insert into public.user_roles (user_id, role) values
  ('98000000-0000-4000-8000-000000000001', 'admin'),
  ('98000000-0000-4000-8000-000000000002', 'author'), ('98000000-0000-4000-8000-000000000002', 'reviewer'),
  ('98000000-0000-4000-8000-000000000003', 'author'),
  ('98000000-0000-4000-8000-000000000004', 'reviewer'),
  ('98000000-0000-4000-8000-000000000005', 'author'),
  ('98000000-0000-4000-8000-000000000006', 'admin'),
  ('98000000-0000-4000-8000-000000000007', 'admin'),
  ('98000000-0000-4000-8000-000000000009', 'author');
alter table public.super_admin disable trigger user;
delete from public.super_admin;
insert into public.super_admin (user_id) values ('98000000-0000-4000-8000-000000000007');
alter table public.super_admin enable trigger user;
-- Deactivated (as deactivate_staff leaves them: profile ended, everything else kept).
update public.profiles set deleted_at = now() - interval '1 day'
where id in ('98000000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000003', '98000000-0000-4000-8000-000000000004',
  '98000000-0000-4000-8000-000000000006', '98000000-0000-4000-8000-000000000009');
-- 3's department is removed afterwards; 8 now uses 4's email.
update public.departments set removed_at = now() where id = 'sr-gone';
update public.profiles set email = 'sr-4@test.invalid' where id = '98000000-0000-4000-8000-000000000008';
-- A session left from before (or started while deactivated), with its refresh token.
insert into auth.sessions (id, user_id) values ('98000000-0000-4000-8000-0000000000c2', '98000000-0000-4000-8000-000000000002');
insert into auth.refresh_tokens (token, user_id, session_id, revoked)
values ('sr-token-2', '98000000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-0000000000c2', false);
-- Their history: an SOP they authored stays theirs.
insert into public.sops (id, title, department_id, author_id, status, current_version) values
  ('98000000-0000-4000-8000-0000000000a2', 'SR Published', 'sr-home', '98000000-0000-4000-8000-000000000005', 'published', 1);
update public.sops set author_id = '98000000-0000-4000-8000-000000000002' where id = '98000000-0000-4000-8000-0000000000a2';

do $$
declare
  admin constant uuid := '98000000-0000-4000-8000-000000000001';
  person constant uuid := '98000000-0000-4000-8000-000000000002';
  moved constant uuid := '98000000-0000-4000-8000-000000000003';
  taken constant uuid := '98000000-0000-4000-8000-000000000004';
  active constant uuid := '98000000-0000-4000-8000-000000000005';
  old_admin constant uuid := '98000000-0000-4000-8000-000000000006';
  blocked constant uuid := '98000000-0000-4000-8000-000000000009';
  v_result jsonb;
  v_before public.profiles;
  v_profiles integer;
  v_audit integer;
begin
  -- ---------- Grants ----------
  assert has_function_privilege('authenticated', 'public.reactivate_staff(uuid)', 'execute'), 'Signed-in users may call it (the function checks who)';
  assert not has_function_privilege('anon', 'public.reactivate_staff(uuid)', 'execute'), 'Not without signing in';
  assert not has_function_privilege('service_role', 'public.reactivate_staff(uuid)', 'execute'), 'Only an Admin, never a server key';

  -- ---------- 1. Who may reactivate ----------
  perform pg_temp.act_as(null, 'anon');
  perform pg_temp.expect_error(format('select public.reactivate_staff(%L)', person), '42501');
  perform pg_temp.act_as(active);
  perform pg_temp.expect_error(format('select public.reactivate_staff(%L)', person), '42501');
  -- A deactivated Admin's token manages nothing.
  perform pg_temp.act_as(old_admin);
  perform pg_temp.expect_error(format('select public.reactivate_staff(%L)', person), '42501');
  perform pg_temp.as_owner();
  assert (select deleted_at from public.profiles where id = person) is not null, 'Refused requests change nothing';

  -- ---------- 2. What can't be reactivated here ----------
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(format('select public.reactivate_staff(%L)', gen_random_uuid()), 'P0002');
  perform pg_temp.expect_error(format('select public.reactivate_staff(%L)', old_admin), '23514', 'admin-managed-separately');
  perform pg_temp.expect_error(format('select public.reactivate_staff(%L)', taken), '23514', 'email-taken');
  perform pg_temp.expect_error(format('select public.reactivate_staff(%L)', moved), '23514', 'department-unavailable');
  perform pg_temp.expect_error(format('select public.reactivate_staff(%L)', blocked), '23514', 'account-unavailable');
  perform pg_temp.as_owner();
  assert (select count(*) from public.profiles where id in (old_admin, taken, moved, blocked) and deleted_at is not null) = 4, 'Still deactivated';

  -- ---------- 3. Reactivate: the same person, as they were ----------
  select * into v_before from public.profiles where id = person;
  select count(*) into v_profiles from public.profiles;
  select count(*) into v_audit from public.organization_management_audit;
  perform pg_temp.act_as(admin);
  v_result := public.reactivate_staff(person);
  assert v_result = jsonb_build_object('id', person, 'alreadyActive', false), 'Returns who, and that it changed';
  perform pg_temp.as_owner();
  assert (select deleted_at from public.profiles where id = person) is null, 'Active again';
  assert (select count(*) from public.profiles) = v_profiles, 'No new profile';
  assert (select count(*) from auth.users where email = 'sr-2@test.invalid') = 1, 'No new sign-in account';
  assert pg_temp.roles(person) = array['author', 'reviewer'], 'The permissions they had';
  assert (select department_id = v_before.department_id and "position" = v_before."position" and full_name = v_before.full_name
    and email = v_before.email and phone = v_before.phone from public.profiles where id = person), 'Details unchanged';
  assert (select author_id from public.sops where id = '98000000-0000-4000-8000-0000000000a2') = person, 'History stays theirs';
  assert not exists (select 1 from auth.sessions where user_id = person), 'No session from before comes back';
  assert not exists (select 1 from auth.refresh_tokens where user_id = person::text), 'No refresh token from before';
  assert (select count(*) from public.organization_management_audit) = v_audit + 1, 'One audit row';
  assert exists (select 1 from public.organization_management_audit where action = 'reactivate-user' and entity_id = person::text
    and actor_id = admin and details->>'source' = 'reactivate-staff' and details ? 'deactivatedAt'), 'Audited';
  -- They can use Hawkim again.
  perform pg_temp.act_as(person);
  assert public.is_active_user(), 'Their access is back';
  assert public.has_role('reviewer'), 'Their permissions work again';

  -- ---------- 4. A repeated request changes nothing ----------
  perform pg_temp.act_as(admin);
  v_result := public.reactivate_staff(person);
  assert v_result = jsonb_build_object('id', person, 'alreadyActive', true), 'Already active';
  perform pg_temp.as_owner();
  assert (select count(*) from public.organization_management_audit) = v_audit + 1, 'No second audit row';

  -- ---------- 5. After its department is fixed in Edit Staff, the moved person can be reactivated ----------
  perform pg_temp.act_as(admin);
  perform public.save_user(moved, 'SR Person 3', '+966512345613', 'Officer', 'sr-home', array['author']::text[], 'sr-gone', array['author']::text[]);
  perform pg_temp.as_owner();
  assert (select deleted_at is not null and department_id = 'sr-home' from public.profiles where id = moved), 'Edited while deactivated, not reactivated';
  perform pg_temp.act_as(admin);
  perform public.reactivate_staff(moved);
  perform pg_temp.as_owner();
  assert (select deleted_at is null from public.profiles where id = moved), 'Now active';

  -- ---------- 6. Edit Staff never turns a deactivated staff member into an Admin ----------
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(format(
    'select public.save_user(%L::uuid, ''SR Person 4'', ''+966512345614'', null, ''sr-home'', array[''admin'']::text[], ''sr-home'', array[''reviewer'']::text[])', taken),
    '23514', 'invalid');
  -- A deactivated Admin is still never edited through Edit Staff.
  perform pg_temp.expect_error(format(
    'select public.save_user(%L::uuid, ''SR Person 6'', ''+966512345616'', null, null, array[''admin'']::text[], ''sr-home'', array[''admin'']::text[])', old_admin),
    'P0002');
  perform pg_temp.expect_error(format('select public.update_user_details(%L, ''X'', ''+966512345616'', ''T'')', old_admin), 'P0002');
end;
$$;

rollback;
