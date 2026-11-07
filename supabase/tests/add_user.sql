-- Tests for 20261107150000_add_user.sql. Only for a disposable LOCAL Supabase/PostgreSQL database with
-- every migration applied; never run it against the shared Supabase project. Everything is rolled
-- back. Two admins adding one email at the same moment need two connections, so that isn't covered here.
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
    assert p_hint is null or v_hint = p_hint, 'Expected hint ' || p_hint || ', got ' || coalesce(v_hint, '(none)');
    rejected := true;
  end;
  assert rejected, 'Expected ' || p_state || ' from ' || p_sql;
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
create function pg_temp.check(p_email text, p_name text, p_phone text, p_position text, p_department text, p_roles text[]) returns text
language sql as $$
  select format('select public.check_new_user(%L, %L, %L, %L, %L, %L::text[])', p_email, p_name, p_phone, p_position, p_department, p_roles);
$$;
create function pg_temp.add(p_user uuid, p_email text, p_department text, p_roles text[], p_name text default 'AU Person', p_position text default 'Title') returns text
language sql as $$
  select format('select public.add_user(%L::uuid, %L, %L, ''+966512345678'', %L, %L, %L::text[])', p_user, p_email, p_name, p_position, p_department, p_roles);
$$;
create function pg_temp.roles(p_user uuid) returns text[]
language sql as $$
  select coalesce(array_agg(r.role::text order by r.role::text), '{}') from public.user_roles r where r.user_id = p_user;
$$;
create function pg_temp.titles(p_user uuid) returns text[]
language sql as $$
  select array_agg(e.title order by e.sort_order, e.title) from public.employee_positions e where e.profile_id = p_user;
$$;

insert into public.divisions (id, name) values ('au-a', 'AU Division A');
insert into public.departments (id, name, initials, division_id) values ('au-home', 'AU Home', 'AH', 'au-a'), ('au-other', 'AU Other', 'AO', 'au-a'), ('au-gone', 'AU Gone', 'AG', 'au-a');
insert into public.departments (id, name, initials, is_quality)
select 'au-quality', 'AU Quality', 'AQ', true where not exists (select 1 from public.departments where is_quality);
update public.departments set removed_at = now() where id = 'au-gone';

-- 1 admin, 2 author (not admin), 3 banned admin, 4 active employee.
-- 5, 6, 7: accounts with no profile. 8: a deleted user with an Author role and two positions. 9: a deleted user.
insert into auth.users (id, email) select ('99000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'au-' || n || '@test.invalid' from generate_series(1, 9) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
select ('99000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'AU Old ' || n, 'au-' || n || '@test.invalid', 'AO', 'au-home', '+966512345678', 'Old Title'
from unnest(array[1, 2, 3, 4, 8, 9]) n;
insert into public.user_roles (user_id, role) values
  ('99000000-0000-4000-8000-000000000001', 'admin'), ('99000000-0000-4000-8000-000000000002', 'author'),
  ('99000000-0000-4000-8000-000000000003', 'admin'), ('99000000-0000-4000-8000-000000000008', 'author');
update auth.users set banned_until = now() + interval '1 day' where id = '99000000-0000-4000-8000-000000000003';
insert into public.employee_positions (profile_id, department_id, title) values ('99000000-0000-4000-8000-000000000008', 'au-home', 'Second');
update public.profiles set deleted_at = now() where id in ('99000000-0000-4000-8000-000000000008', '99000000-0000-4000-8000-000000000009');

do $$
declare
  admin constant uuid := '99000000-0000-4000-8000-000000000001';
  author constant uuid := '99000000-0000-4000-8000-000000000002';
  banned constant uuid := '99000000-0000-4000-8000-000000000003';
  employee constant uuid := '99000000-0000-4000-8000-000000000004';
  fresh1 constant uuid := '99000000-0000-4000-8000-000000000005';
  fresh2 constant uuid := '99000000-0000-4000-8000-000000000006';
  fresh3 constant uuid := '99000000-0000-4000-8000-000000000007';
  deleted1 constant uuid := '99000000-0000-4000-8000-000000000008';
  deleted2 constant uuid := '99000000-0000-4000-8000-000000000009';
  phone constant text := '+966512345678';
  quality text;
  result jsonb;
  person public.profiles;
begin
  select id into quality from public.departments where is_quality;

  -- ---------- Who can call them ----------
  assert not has_function_privilege('anon', 'public.check_new_user(text, text, text, text, text, text[])', 'execute');
  assert not has_function_privilege('service_role', 'public.check_new_user(text, text, text, text, text, text[])', 'execute');
  assert has_function_privilege('authenticated', 'public.check_new_user(text, text, text, text, text, text[])', 'execute');
  assert not has_function_privilege('anon', 'public.add_user(uuid, text, text, text, text, text, text[])', 'execute');
  assert not has_function_privilege('service_role', 'public.add_user(uuid, text, text, text, text, text, text[])', 'execute');
  assert has_function_privilege('authenticated', 'public.add_user(uuid, text, text, text, text, text, text[])', 'execute');
  foreach person.id in array array[author, banned] loop
    perform pg_temp.act_as(person.id);
    perform pg_temp.expect_error(pg_temp.check('au-5@test.invalid', 'N', phone, 'T', 'au-home', '{}'), '42501');
    perform pg_temp.expect_error(pg_temp.add(fresh1, 'au-5@test.invalid', 'au-home', '{}'), '42501');
  end loop;

  -- ---------- What check_new_user refuses, changing nothing ----------
  perform pg_temp.act_as(admin);
  perform public.check_new_user('au-5@test.invalid', 'New Person', phone, 'Title', 'au-home', '{author,reviewer}');
  perform public.check_new_user('au-5@test.invalid', repeat('n', 100), phone, repeat('p', 100), 'au-home', '{}');
  perform public.check_new_user('au-5@test.invalid', 'New Person', phone, 'Title', quality, '{approver}');
  perform public.check_new_user('au-5@test.invalid', 'New Person', phone, 'Title', 'au-home', '{admin}');
  foreach person.email in array array['AU-5@test.invalid', ' au-5@test.invalid', 'not-an-email', 'a b@test.invalid', repeat('a', 250) || '@b.co'] loop
    perform pg_temp.expect_error(pg_temp.check(person.email, 'N', phone, 'T', 'au-home', '{}'), '23514', 'invalid');
  end loop;
  perform pg_temp.expect_error(pg_temp.check(null, 'N', phone, 'T', 'au-home', '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', '  ', phone, 'T', 'au-home', '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', repeat('n', 101), phone, 'T', 'au-home', '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', '0512345678', 'T', 'au-home', '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', null, 'T', 'au-home', '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', phone, ' ', 'au-home', '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', phone, repeat('p', 101), 'au-home', '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', phone, 'T', null, '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', phone, 'T', 'au-home', null), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', phone, 'T', 'au-home', '{owner}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.check('au-4@test.invalid', 'N', phone, 'T', 'au-home', '{}'), '23514', 'email-taken');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', phone, 'T', 'au-home', '{admin,author}'), '23514', 'admin-exclusive');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', phone, 'T', 'au-gone', '{}'), '23514', 'department-unavailable');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', phone, 'T', 'nowhere', '{}'), '23514', 'department-unavailable');
  perform pg_temp.expect_error(pg_temp.check('x@test.invalid', 'N', phone, 'T', 'au-home', '{approver}'), '23514', 'approver-quality');
  -- A deleted user's email is free.
  perform public.check_new_user('au-8@test.invalid', 'N', phone, 'T', 'au-home', '{}');

  -- ---------- add_user's own refusals, leaving no profile behind ----------
  -- Another person's account, or one that doesn't exist.
  perform pg_temp.expect_error(pg_temp.add(fresh1, 'au-6@test.invalid', 'au-home', '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.add(gen_random_uuid(), 'nobody@test.invalid', 'au-home', '{}'), '23514', 'invalid');
  -- A different email, with the account of an active user.
  perform pg_temp.as_owner();
  update auth.users set email = 'au-moved@test.invalid' where id = employee;
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(pg_temp.add(employee, 'au-moved@test.invalid', 'au-home', '{}'), '23514', 'email-taken');
  -- An email another active user has, even when this account now has it: the check runs first.
  perform pg_temp.as_owner();
  update auth.users set email = 'au-4@test.invalid' where id = fresh2;
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(pg_temp.add(fresh2, 'au-4@test.invalid', 'au-home', '{}'), '23514', 'email-taken');
  perform pg_temp.as_owner();
  update auth.users set email = 'au-6@test.invalid' where id = fresh2;
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(pg_temp.add(fresh1, 'au-5@test.invalid', 'au-home', '{approver}'), '23514', 'approver-quality');
  perform pg_temp.expect_error(pg_temp.add(fresh1, 'au-5@test.invalid', 'au-home', '{admin,author}'), '23514', 'admin-exclusive');
  perform pg_temp.as_owner();
  assert not exists (select 1 from public.profiles where id = fresh1), 'A refused add left a profile';

  -- ---------- A new user ----------
  perform pg_temp.act_as(admin);
  result := public.add_user(fresh1, 'au-5@test.invalid', '  Rana Saleh  ', phone, ' New Title ', 'au-home', '{reviewer,author}');
  assert result->>'id' = fresh1::text and result->>'email' = 'au-5@test.invalid' and result->>'name' = 'Rana Saleh' and result->>'initials' = 'RS', result::text;
  assert result->>'position' = 'New Title' and result->>'departmentId' = 'au-home' and result->'permissions' = '["author", "reviewer"]'::jsonb, result::text;
  perform pg_temp.as_owner();
  select * into person from public.profiles where id = fresh1;
  assert person.full_name = 'Rana Saleh' and person.initials = 'RS' and person.phone = phone and person."position" = 'New Title' and person.deleted_at is null;
  assert pg_temp.roles(fresh1) = '{author,reviewer}';
  assert pg_temp.titles(fresh1) = array['New Title'], pg_temp.titles(fresh1)::text;
  assert exists (select 1 from public.organization_management_audit a where a.action = 'add-user' and a.entity_id = fresh1::text and a.actor_id = admin and a.details = '{"readded": false}'::jsonb);
  -- Adding them again is refused, even with their own account.
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(pg_temp.add(fresh1, 'au-5@test.invalid', 'au-home', '{}'), '23514', 'email-taken');
  -- A single-word name; an Approver in Quality; a new Admin; no roles at all.
  result := public.add_user(fresh2, 'au-6@test.invalid', 'Rana', phone, 'T', quality, '{approver}');
  assert result->>'initials' = 'RA', result::text;
  perform public.add_user(fresh3, 'au-7@test.invalid', 'New Admin', phone, 'T', 'au-home', '{admin}');
  perform pg_temp.as_owner();
  assert pg_temp.roles(fresh2) = '{approver}' and pg_temp.roles(fresh3) = '{admin}';

  -- ---------- Re-adding someone deleted ----------
  perform pg_temp.act_as(admin);
  result := public.add_user(deleted2, 'au-9@test.invalid', 'Back Again', phone, 'New Job', 'au-other', '{reviewer}');
  assert result->>'name' = 'Back Again' and result->>'departmentId' = 'au-other', result::text;
  perform pg_temp.as_owner();
  select * into person from public.profiles where id = deleted2;
  assert person.deleted_at is null and person.full_name = 'Back Again' and person.department_id = 'au-other' and person."position" = 'New Job';
  assert pg_temp.roles(deleted2) = '{reviewer}';
  assert pg_temp.titles(deleted2) = array['New Job'], pg_temp.titles(deleted2)::text;
  assert exists (select 1 from public.organization_management_audit a where a.action = 'add-user' and a.entity_id = deleted2::text and a.details = '{"readded": true}'::jsonb);
  -- Old roles are replaced, including removing one no longer needed.
  perform pg_temp.act_as(admin);
  result := public.add_user(deleted1, 'au-8@test.invalid', 'AU Old 8', phone, 'Old Title', 'au-home', '{reviewer}');
  perform pg_temp.as_owner();
  assert pg_temp.roles(deleted1) = '{reviewer}', pg_temp.roles(deleted1)::text;

  -- A re-add can't remove a permission still in use, and nothing is saved.
  update public.profiles set deleted_at = now() where id = deleted1;
  insert into public.user_roles (user_id, role) values (deleted1, 'author');
  insert into public.sops (id, title, department_id, author_id, current_version) values ('99000000-0000-4000-8000-0000000000aa', 'AU SOP', 'au-home', deleted1, 1);
  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values ('99000000-0000-4000-8000-0000000000aa', 1, 'a.pdf', 'pdf', 'au/a.pdf', 1, deleted1);
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(pg_temp.add(deleted1, 'au-8@test.invalid', 'au-home', '{}'), '23514', 'permission-in-use');
  perform pg_temp.as_owner();
  assert (select deleted_at from public.profiles where id = deleted1) is not null, 'A refused re-add reactivated the user';
  assert pg_temp.roles(deleted1) = '{author,reviewer}', pg_temp.roles(deleted1)::text;
  -- With those permissions kept, it works.
  perform pg_temp.act_as(admin);
  perform public.add_user(deleted1, 'au-8@test.invalid', 'AU Old 8', phone, 'Old Title', 'au-home', '{author,reviewer}');
  perform pg_temp.as_owner();
  assert (select deleted_at from public.profiles where id = deleted1) is null;
end;
$$;

-- Runs the deferred position rules as a real commit would.
set constraints all immediate;
rollback;
