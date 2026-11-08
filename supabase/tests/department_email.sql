-- Tests for 20261108150000_department_email.sql. Only for a disposable LOCAL database with every
-- migration applied; never the shared project. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text) returns void
language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute p_sql;
  exception when others then
    if sqlstate <> p_state then raise; end if;
    rejected := true;
  end;
  assert rejected, 'Expected ' || p_state || ' from ' || p_sql;
end;
$$;
create function pg_temp.act_as(p_user text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user, ''), true);
end;
$$;
create function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- People: 1 admin, 2 author (not admin).
insert into public.divisions(id, name) values ('de-division', 'DE Division');
insert into public.departments(id, name, initials, division_id) values ('de-existing', 'DE Existing', 'DX', 'de-division');
insert into auth.users(id) select ('95000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 2) n;
insert into public.profiles(id, full_name, email, initials, department_id, "position")
select ('95000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'DE person ' || n, 'de-' || n || '@test.invalid', 'DP',
  'de-existing', 'Title ' || n
from generate_series(1, 2) n;
insert into public.user_roles(user_id, role) values
  ('95000000-0000-4000-8000-000000000001', 'admin'), ('95000000-0000-4000-8000-000000000002', 'author');

do $$
declare
  admin constant text := '95000000-0000-4000-8000-000000000001';
  author constant text := '95000000-0000-4000-8000-000000000002';
  v_department text; v_other text; v_stamp timestamptz;
begin
  -- ---------- schema ----------
  assert (select email is null from public.departments where id = 'de-existing'), 'Existing departments have no email';
  assert not has_column_privilege('authenticated', 'public.departments', 'email', 'select'), 'Email is not directly readable';
  assert has_column_privilege('authenticated', 'public.departments', 'name', 'select')
    and has_column_privilege('authenticated', 'public.departments', 'description', 'select')
    and has_column_privilege('authenticated', 'public.departments', 'division_id', 'select')
    and has_column_privilege('authenticated', 'public.departments', 'removed_at', 'select'), 'Existing columns stay readable';
  assert to_regprocedure('public.save_department(text,text,text,text,text,timestamptz)') is null, 'The 6-parameter version is gone';
  assert not has_function_privilege('anon', 'public.save_department(text,text,text,text,text,timestamptz,text)', 'execute');
  assert has_function_privilege('authenticated', 'public.save_department(text,text,text,text,text,timestamptz,text)', 'execute');

  -- ---------- a non-admin ----------
  perform pg_temp.act_as(author);
  assert (select count(*) = 1 from public.departments where id = 'de-existing'), 'An active user still reads departments';
  perform pg_temp.expect_error($q$select email from public.departments where id = 'de-existing'$q$, '42501');
  perform pg_temp.expect_error($q$select public.save_department(null,'DE X','DQ','','de-division',null,'x@hawkim.test')$q$, '42501');

  -- ---------- the admin ----------
  perform pg_temp.act_as(admin);
  -- Optional: no email (old 6-argument call style) and a blank email are both stored as none.
  v_department := public.save_department(null, 'DE None', 'DN', '', 'de-division');
  perform pg_temp.as_owner();
  assert (select email is null from public.departments where id = v_department), 'No email';
  perform pg_temp.act_as(admin);
  v_other := public.save_department(null, 'DE Blank', 'DB', '', 'de-division', null, '   ');
  perform pg_temp.as_owner();
  assert (select email is null from public.departments where id = v_other), 'Blank email is stored as none';

  -- Trimmed and saved; shown in the admin snapshot.
  perform pg_temp.act_as(admin);
  v_department := public.save_department(null, 'DE Mail', 'DM', '', 'de-division', null, ' team@hawkim.test ');
  assert jsonb_path_exists(public.get_divisions_departments(), '$.departments[*] ? (@.name == "DE Mail" && @.email == "team@hawkim.test")'), 'Trimmed';
  assert jsonb_path_exists(public.get_divisions_departments(), '$.departments[*] ? (@.id == "de-existing" && @.email == null)'), 'Existing in snapshot';

  -- Not unique.
  perform public.save_department(null, 'DE Same', 'DS', '', 'de-division', null, 'team@hawkim.test');

  -- Invalid format or too long.
  perform pg_temp.expect_error($q$select public.save_department(null,'DE Bad','DE','','de-division',null,'not-an-email')$q$, '23514');
  perform pg_temp.expect_error($q$select public.save_department(null,'DE Bad','DE','','de-division',null,'a b@hawkim.test')$q$, '23514');
  perform pg_temp.expect_error(format($q$select public.save_department(null,'DE Long','DL','','de-division',null,%L)$q$,
    repeat('a', 243) || '@hawkim.test'), '23514');
  -- Exactly 254 characters is allowed.
  perform public.save_department(null, 'DE Max', 'DZ', '', 'de-division', null, repeat('a', 242) || '@hawkim.test');

  -- Editing sets, changes and clears the email.
  perform pg_temp.as_owner();
  select updated_at into v_stamp from public.departments where id = v_department;
  perform pg_temp.act_as(admin);
  perform public.save_department(v_department, 'DE Mail', 'DM', '', 'de-division', v_stamp, 'qa@hawkim.test');
  perform pg_temp.as_owner();
  assert (select email = 'qa@hawkim.test' from public.departments where id = v_department), 'Changed';
  select updated_at into v_stamp from public.departments where id = v_department;
  perform pg_temp.act_as(admin);
  perform public.save_department(v_department, 'DE Mail', 'DM', '', 'de-division', v_stamp, '');
  perform pg_temp.as_owner();
  assert (select email is null from public.departments where id = v_department), 'Cleared';

  -- The table check also refuses a bad email written directly.
  perform pg_temp.expect_error($q$update public.departments set email = 'nope' where id = 'de-existing'$q$, '23514');
end;
$$;

rollback;
