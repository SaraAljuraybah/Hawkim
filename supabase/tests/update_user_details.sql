-- Tests for 20261107130000_update_user_details.sql. Only for a disposable LOCAL Supabase/PostgreSQL
-- database with every migration applied; never run it against the shared Supabase project.
-- Everything is rolled back.
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
  perform set_config('request.jwt.claim.sub', p_user, true);
end;
$$;
create function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
create function pg_temp.titles(p_user uuid) returns text[]
language sql as $$
  select array_agg(e.title order by e.sort_order, e.title) from public.employee_positions e where e.profile_id = p_user;
$$;

-- People: 1 admin, 2 author (not admin), 3 banned admin, 4 target, 5 deleted, 6 target without a position.
insert into public.departments(id, name, initials) values ('ud-home', 'UD Home', 'UH');
insert into auth.users(id) select ('95000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 6) n;
-- Person 6 is a legacy profile: it was added before a position was required.
alter table public.profiles disable trigger profiles_require_position;
insert into public.profiles(id, full_name, email, initials, department_id, "position")
select ('95000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'UD Person ' || n, 'ud-' || n || '@test.invalid', 'UP', 'ud-home',
  case when n = 6 then null else 'Title ' || n end
from generate_series(1, 6) n;
alter table public.profiles enable trigger profiles_require_position;
insert into public.user_roles(user_id, role) values
  ('95000000-0000-4000-8000-000000000001', 'admin'), ('95000000-0000-4000-8000-000000000002', 'author'),
  ('95000000-0000-4000-8000-000000000003', 'admin');
update auth.users set banned_until = now() + interval '1 day' where id = '95000000-0000-4000-8000-000000000003';
update public.profiles set deleted_at = now() where id = '95000000-0000-4000-8000-000000000005';

do $$
declare
  admin constant text := '95000000-0000-4000-8000-000000000001';
  author constant text := '95000000-0000-4000-8000-000000000002';
  banned constant text := '95000000-0000-4000-8000-000000000003';
  target constant uuid := '95000000-0000-4000-8000-000000000004';
  gone constant uuid := '95000000-0000-4000-8000-000000000005';
  legacy constant uuid := '95000000-0000-4000-8000-000000000006';
  phone constant text := '+966512345678';
  call_for_target text := format('select public.update_user_details(%L, ''New Name'', %L, ''Title 4'')', target, phone);
  person public.profiles;
  result jsonb;
  audits integer;
begin
  -- ---------- Who can call it ----------
  assert not has_function_privilege('anon', 'public.update_user_details(uuid, text, text, text)', 'execute');
  assert not has_function_privilege('service_role', 'public.update_user_details(uuid, text, text, text)', 'execute');
  assert has_function_privilege('authenticated', 'public.update_user_details(uuid, text, text, text)', 'execute');
  perform set_config('role', 'anon', true);
  perform pg_temp.expect_error(call_for_target, '42501');
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(call_for_target, '42501');
  perform pg_temp.act_as(banned);
  perform pg_temp.expect_error(call_for_target, '42501');
  -- The browser still can't change the table directly, even as an admin.
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(format('update public.profiles set full_name = ''X'' where id = %L', target), '42501');

  -- ---------- What it refuses ----------
  perform pg_temp.expect_error(format('select public.update_user_details(%L, ''  '', %L, ''T'')', target, phone), '23514');
  perform pg_temp.expect_error(format('select public.update_user_details(%L, repeat(''n'', 101), %L, ''T'')', target, phone), '23514');
  perform pg_temp.expect_error(format('select public.update_user_details(%L, ''N'', ''0512345678'', ''T'')', target), '23514');
  perform pg_temp.expect_error(format('select public.update_user_details(%L, ''N'', null, ''T'')', target), '23514');
  perform pg_temp.expect_error(format('select public.update_user_details(%L, ''N'', %L, ''  '')', target, phone), '23514');
  perform pg_temp.expect_error(format('select public.update_user_details(%L, ''N'', %L, repeat(''p'', 101))', target, phone), '23514');
  -- A deactivated staff member is found (Edit Staff on the Deactive Staff tab) and stays deactivated.
  perform public.update_user_details(gone, 'Gone Person', phone, 'New Title');
  assert (select deleted_at is not null and "position" = 'New Title' from public.profiles where id = gone), 'Edited, still deactivated';
  perform pg_temp.expect_error(format('select public.update_user_details(%L, ''N'', %L, ''T'')', gen_random_uuid(), phone), 'P0002');

  -- ---------- A name and phone change: initials follow, position and its rows untouched ----------
  result := public.update_user_details(target, '  Rana Saleh  ', phone, 'Title 4');
  assert result = jsonb_build_object('name', 'Rana Saleh', 'initials', 'RS', 'phone', phone, 'position', 'Title 4'), result::text;
  perform pg_temp.as_owner();
  select * into person from public.profiles where id = target;
  assert person.full_name = 'Rana Saleh' and person.initials = 'RS' and person.phone = phone;
  assert person.email = 'ud-4@test.invalid' and person.department_id = 'ud-home', 'Email and department are not changed';
  assert pg_temp.titles(target) = array['Title 4'];
  select count(*) into audits from public.organization_management_audit
  where action = 'update-user-details' and entity_id = target::text and actor_id = admin::uuid
    and details = jsonb_build_object('fields', jsonb_build_array('name', 'phone'));
  assert audits = 1, 'Audited with the changed field names, not their values';

  -- Initials stay when the name doesn't change, and a single word gives two letters.
  update public.profiles set initials = 'ZZ' where id = target;
  perform pg_temp.act_as(admin);
  perform public.update_user_details(target, 'Rana Saleh', phone, 'Title 4');
  perform pg_temp.as_owner();
  assert (select initials from public.profiles where id = target) = 'ZZ';
  perform pg_temp.act_as(admin);
  assert public.update_user_details(target, 'Rana', phone, 'Title 4')->>'initials' = 'RA';

  -- ---------- Position, through the existing trigger ----------
  -- Secondary titles stay when the primary is renamed.
  perform pg_temp.act_as(admin);
  perform public.set_employee_positions(target, array['Title 4', 'Second']);
  perform public.update_user_details(target, 'Rana', phone, 'Renamed');
  perform pg_temp.as_owner();
  assert pg_temp.titles(target) = array['Renamed', 'Second'], pg_temp.titles(target)::text;
  -- Only the letter case changes.
  perform pg_temp.act_as(admin);
  perform public.update_user_details(target, 'Rana', phone, 'RENAMED');
  perform pg_temp.as_owner();
  assert pg_temp.titles(target) = array['RENAMED', 'Second'], pg_temp.titles(target)::text;
  -- A secondary title becomes primary: the old primary title is removed, one row remains.
  perform pg_temp.act_as(admin);
  perform public.update_user_details(target, 'Rana', phone, 'Second');
  perform pg_temp.as_owner();
  assert pg_temp.titles(target) = array['Second'], pg_temp.titles(target)::text;
  assert (select "position" from public.profiles where id = target) = 'Second';
  -- A user without a position gets one row.
  perform pg_temp.act_as(admin);
  perform public.update_user_details(legacy, 'Old Person', phone, 'First Title');
  perform pg_temp.as_owner();
  assert pg_temp.titles(legacy) = array['First Title'], pg_temp.titles(legacy)::text;
  -- An unchanged position doesn't reorder a user's titles.
  perform pg_temp.act_as(admin);
  perform public.set_employee_positions(target, array['Second', 'Third']);
  perform pg_temp.as_owner();
  update public.employee_positions set sort_order = 5 where profile_id = target and title = 'Second';
  perform pg_temp.act_as(admin);
  perform public.update_user_details(target, 'Rana', phone, 'Second');
  perform pg_temp.as_owner();
  assert (select sort_order from public.employee_positions where profile_id = target and title = 'Second') = 5, 'Position trigger ran';

  -- An admin can edit their own details: no such rule exists.
  perform pg_temp.act_as(admin);
  assert public.update_user_details(admin::uuid, 'Own Name', phone, 'Title 1')->>'name' = 'Own Name';
end;
$$;

-- Runs the deferred position rules as a real commit would.
set constraints all immediate;
rollback;
