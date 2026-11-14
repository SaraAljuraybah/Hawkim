-- Tests for 20261111140000_organization_settings.sql: who can read and change the organization's name,
-- and what is stored. Every call is made as the API would make it (role anon or authenticated, with the
-- caller's id in the JWT claims). Only for a disposable LOCAL database with every migration applied;
-- never the shared project. Everything is rolled back.
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
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner() to public;

-- People: 1 the Super Admin, 2 a regular Admin, 3 staff, 4 a former staff member (profile ended).
insert into auth.users (id, email)
select ('9c000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'os-' || n || '@test.invalid' from generate_series(1, 4) n;
insert into public.departments (id, name, initials) values ('os-home', 'OS Home', 'OH') on conflict do nothing;
insert into public.profiles (id, full_name, email, initials, department_id, deleted_at)
select ('9c000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'OS Person ' || n, 'os-' || n || '@test.invalid', 'OP', 'os-home',
       case when n = 4 then now() end
from generate_series(1, 4) n;
insert into public.user_roles (user_id, role) values
  ('9c000000-0000-4000-8000-000000000001', 'admin'), ('9c000000-0000-4000-8000-000000000002', 'admin'),
  ('9c000000-0000-4000-8000-000000000003', 'author'), ('9c000000-0000-4000-8000-000000000004', 'author');
-- Person 1 is the Super Admin (any earlier designation is replaced; rolled back).
alter table public.super_admin disable trigger user;
delete from public.super_admin;
alter table public.super_admin enable trigger user;
insert into public.super_admin (user_id) values ('9c000000-0000-4000-8000-000000000001');

do $$
declare
  sa constant uuid := '9c000000-0000-4000-8000-000000000001';
  admin constant uuid := '9c000000-0000-4000-8000-000000000002';
  staff constant uuid := '9c000000-0000-4000-8000-000000000003';
  former constant uuid := '9c000000-0000-4000-8000-000000000004';
  v_name text;
begin
  -- ---------- Grants: the table is closed; only signed-in users may call the functions ----------
  assert not has_table_privilege('authenticated', 'public.organization_settings', 'select'), 'not readable directly';
  assert not has_table_privilege('authenticated', 'public.organization_settings', 'insert'), 'not writable directly';
  assert not has_table_privilege('anon', 'public.organization_settings', 'select');
  assert not has_table_privilege('service_role', 'public.organization_settings', 'update');
  assert (select relrowsecurity from pg_class where oid = 'public.organization_settings'::regclass), 'RLS is on';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_settings'), 'no policies';
  assert not has_function_privilege('anon', 'public.get_organization_name()', 'execute');
  assert not has_function_privilege('anon', 'public.set_organization_name(text)', 'execute');
  assert has_function_privilege('authenticated', 'public.get_organization_name()', 'execute');
  assert has_function_privilege('authenticated', 'public.set_organization_name(text)', 'execute');

  -- ---------- Starts empty: no name for anyone ----------
  assert (select count(*) from public.organization_settings) = 0, 'starts empty';
  perform pg_temp.act_as(staff);
  assert public.get_organization_name() is null, 'no name yet';

  -- ---------- Direct access is refused, even for the Super Admin ----------
  perform pg_temp.act_as(sa);
  perform pg_temp.expect_error('select * from public.organization_settings', '42501');
  perform pg_temp.expect_error($q$insert into public.organization_settings (name) values ('Direct')$q$, '42501');
  perform pg_temp.act_as(null, 'anon');
  perform pg_temp.expect_error($q$select public.set_organization_name('Anon Pharma')$q$, '42501');
  perform pg_temp.expect_error('select public.get_organization_name()', '42501');

  -- ---------- Negative: a regular Admin, staff and a former staff member can't change it ----------
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error($q$select public.set_organization_name('Admin Pharma')$q$, '42501', 'super-admin-required');
  perform pg_temp.act_as(staff);
  perform pg_temp.expect_error($q$select public.set_organization_name('Staff Pharma')$q$, '42501', 'super-admin-required');
  perform pg_temp.act_as(former);
  perform pg_temp.expect_error($q$select public.set_organization_name('Former Pharma')$q$, '42501', 'super-admin-required');
  perform pg_temp.as_owner();
  assert (select count(*) from public.organization_settings) = 0, 'nothing saved by the refused calls';

  -- ---------- The Super Admin saves it, trimmed; everyone with an active profile reads it ----------
  perform pg_temp.act_as(sa);
  v_name := public.set_organization_name('   Riyadh   Pharma  ');
  assert v_name = 'Riyadh   Pharma', 'trimmed at both ends only, returned';
  perform pg_temp.act_as(admin);
  assert public.get_organization_name() = 'Riyadh   Pharma', 'an Admin reads it';
  perform pg_temp.act_as(staff);
  assert public.get_organization_name() = 'Riyadh   Pharma', 'staff read it';
  perform pg_temp.act_as(former);
  assert public.get_organization_name() is null, 'a former staff member gets nothing';
  perform pg_temp.as_owner();
  assert (select updated_by = sa and updated_at <= now() from public.organization_settings), 'who saved it';

  -- ---------- Changing it again keeps one row ----------
  perform pg_temp.act_as(sa);
  perform public.set_organization_name('Jeddah Pharma');
  perform pg_temp.as_owner();
  assert (select count(*) = 1 and min(name) = 'Jeddah Pharma' from public.organization_settings), 'one row, the new name';

  -- ---------- Invalid names are refused and the saved one stays ----------
  perform pg_temp.act_as(sa);
  perform pg_temp.expect_error($q$select public.set_organization_name('   ')$q$, '22023', 'invalid');
  perform pg_temp.expect_error($q$select public.set_organization_name(null)$q$, '22023', 'invalid');
  perform pg_temp.expect_error(format('select public.set_organization_name(%L)', repeat('x', 201)), '22023', 'invalid');
  perform pg_temp.expect_error($q$select public.set_organization_name(E'Two\nLines')$q$, '22023', 'invalid');
  v_name := public.set_organization_name(repeat('y', 200));
  assert char_length(v_name) = 200, '200 characters is allowed';
  perform public.set_organization_name('Jeddah Pharma');
  assert public.get_organization_name() = 'Jeddah Pharma', 'still the last valid name';

  -- ---------- The table itself keeps one valid row, even for the owner ----------
  perform pg_temp.as_owner();
  perform pg_temp.expect_error($q$insert into public.organization_settings (singleton, name) values (false, 'Second')$q$, '23514');
  perform pg_temp.expect_error($q$insert into public.organization_settings (name) values ('Second')$q$, '23505');
  perform pg_temp.expect_error($q$update public.organization_settings set name = ' Padded '$q$, '23514');
  perform pg_temp.expect_error($q$update public.organization_settings set name = ''$q$, '23514');

  -- ---------- After a transfer, only the new Super Admin can change it ----------
  perform pg_temp.act_as(sa);
  perform public.transfer_super_admin(admin);
  perform pg_temp.expect_error($q$select public.set_organization_name('Old Super Admin')$q$, '42501', 'super-admin-required');
  perform pg_temp.act_as(admin);
  assert public.set_organization_name('Dammam Pharma') = 'Dammam Pharma', 'the new Super Admin can';
end;
$$;

rollback;
