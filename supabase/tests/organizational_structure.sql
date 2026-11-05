-- Disposable local database only, after all migrations. No changes survive rollback.
begin;
set local plpgsql.check_asserts = on;
insert into public.divisions(id, name) values ('org-test-division', 'Test Division');
insert into public.divisions(id, name, is_active) values ('org_empty_division', 'Empty Division', true), ('org_inactive_division', 'Inactive Division', false);
insert into public.departments(id, name, initials, division_id) values
 ('org-test-home', 'Test Home', 'TH', 'org-test-division'),
 ('org-test-empty', 'Test Empty', 'TE', null),
 ('org-test-removed', 'Test Removed', 'TR', null);
update public.departments set removed_at = now() where id = 'org-test-removed';
insert into auth.users(id) select ('f4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 3) n;
insert into public.profiles(id, full_name, email, initials, department_id)
select ('f4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Org Test ' || n, 'org-test-' || n || '@test.invalid', 'OT', 'org-test-home'
from generate_series(1, 3) n;
insert into public.user_roles(user_id, role) values
 ('f4000000-0000-4000-8000-000000000001', 'admin'),
 ('f4000000-0000-4000-8000-000000000002', 'author'),
 ('f4000000-0000-4000-8000-000000000002', 'reviewer');
update public.profiles set deleted_at = now() where id = 'f4000000-0000-4000-8000-000000000003';

do $$
declare snapshot jsonb; home jsonb; rejected boolean := false; caller text; row_count integer;
begin
  assert not has_function_privilege('anon', 'public.get_organizational_structure()', 'execute'), 'Anonymous execution must be denied';
  assert not has_function_privilege('anon', 'public.can_read_organizational_structure()', 'execute');
  assert not has_table_privilege('anon', 'public.divisions', 'select');
  assert not has_any_column_privilege('anon', 'public.divisions', 'select');
  assert (select not prosecdef from pg_proc where oid = 'public.get_organizational_structure()'::regprocedure), 'Hierarchy must retain invoker RLS';
  set local role anon;
  begin perform public.get_organizational_structure();
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'Anonymous invocation must fail';
  rejected := false;
  begin perform id from public.divisions;
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'Anonymous direct column access must fail';
  reset role;
  set local role authenticated;
  -- Missing, nonexistent, malformed and deleted-profile identities.
  foreach caller in array array['', 'f4000000-0000-4000-8000-000000000099', 'not-a-uuid',
    'f4000000-0000-4000-8000-000000000003']
  loop
    perform set_config('request.jwt.claim.sub', caller, true);
    rejected := false;
    begin perform public.get_organizational_structure();
    exception when insufficient_privilege or invalid_text_representation then rejected := true;
    end;
    assert rejected, 'Invalid or unauthorized caller must be refused';
  end loop;
  -- Every active user, not only Admins, can view the structure and read divisions.
  perform set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000002', true);
  snapshot := public.get_organizational_structure();
  assert exists(select 1 from jsonb_array_elements(snapshot->'departments') where value->>'id' = 'org-test-home'), 'Non-admin active users must see the structure';
  select count(*) into row_count from public.divisions where id like 'org%';
  assert row_count = 3, 'Non-admin active users must read divisions';
  -- The existing employee directory remains readable.
  assert exists(select 1 from public.profiles where id = 'f4000000-0000-4000-8000-000000000002');
  assert exists(select 1 from public.departments where id = 'org-test-home');
  assert exists(select 1 from public.user_roles where user_id = 'f4000000-0000-4000-8000-000000000002');
  perform set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000001', true);
  snapshot := public.get_organizational_structure();
  assert jsonb_typeof(snapshot) = 'object' and snapshot ?& array['organization', 'divisions', 'departments'];
  assert snapshot->'organization' = 'null'::jsonb;
  assert jsonb_typeof(snapshot->'divisions') = 'array' and jsonb_typeof(snapshot->'departments') = 'array';
  assert exists(select 1 from jsonb_array_elements(snapshot->'divisions') where value->>'id' = 'org_empty_division'), 'Empty divisions remain visible';
  assert not exists(select 1 from jsonb_array_elements(snapshot->'divisions') where value->>'id' = 'org_inactive_division');
  select value into home from jsonb_array_elements(snapshot->'departments') where value->>'id' = 'org-test-home';
  assert home->>'divisionId' = 'org-test-division';
  assert (select count(*) = 4 from jsonb_object_keys(home));
  assert jsonb_array_length(home->'employees') = 2, 'Deleted employees must not count';
  assert (select value->'permissions' @> '["author", "reviewer"]'::jsonb from jsonb_array_elements(home->'employees') where value->>'id' = 'f4000000-0000-4000-8000-000000000002');
  assert not exists(select 1 from jsonb_array_elements(home->'employees') where value ? 'phone');
  assert (select value->>'email' = 'org-test-2@test.invalid' from jsonb_array_elements(home->'employees') where value->>'id' = 'f4000000-0000-4000-8000-000000000002'), 'Employees carry their profile email';
  assert not exists(select 1 from jsonb_array_elements(home->'employees') e
    where not (e.value ?& array['id', 'name', 'initials', 'email', 'position', 'permissions'])
      or (select count(*) <> 6 from jsonb_object_keys(e.value))
      or jsonb_typeof(e.value->'permissions') <> 'array');
  assert not exists(select 1 from jsonb_array_elements(snapshot->'departments') where value->>'id' = 'org-test-removed');
  assert (select jsonb_array_length(value->'employees') = 0 from jsonb_array_elements(snapshot->'departments') where value->>'id' = 'org-test-empty');
  reset role;
  update public.profiles set department_id = 'org-test-empty' where id = 'f4000000-0000-4000-8000-000000000002';
  set local role authenticated;
  snapshot := public.get_organizational_structure();
  assert (select jsonb_array_length(value->'employees') = 1 from jsonb_array_elements(snapshot->'departments') where value->>'id' = 'org-test-home');
  assert (select value->'employees'->0->>'name' = 'Org Test 2' from jsonb_array_elements(snapshot->'departments') where value->>'id' = 'org-test-empty');
  reset role;
  update public.departments set name = 'Renamed Department' where id = 'org-test-empty';
  update public.profiles set full_name = 'Renamed Person', position = 'Stored Position' where id = 'f4000000-0000-4000-8000-000000000002';
  delete from public.user_roles where user_id = 'f4000000-0000-4000-8000-000000000002' and role = 'author';
  set local role authenticated;
  snapshot := public.get_organizational_structure();
  select value into home from jsonb_array_elements(snapshot->'departments') where value->>'id' = 'org-test-empty';
  assert home->>'name' = 'Renamed Department';
  assert home->'employees'->0->>'name' = 'Renamed Person';
  assert home->'employees'->0->>'position' = 'Stored Position';
  assert home->'employees'->0->'permissions' = '["reviewer"]'::jsonb;
  reset role;
  rejected := false;
  begin delete from public.divisions where id = 'org-test-division';
  exception when foreign_key_violation then rejected := true;
  end;
  assert rejected, 'Referenced divisions must retain ON DELETE RESTRICT';
  delete from public.user_roles where user_id = 'f4000000-0000-4000-8000-000000000002';
  set local role authenticated;
  snapshot := public.get_organizational_structure();
  assert (select value->'employees'->0->'permissions' = '[]'::jsonb from jsonb_array_elements(snapshot->'departments') where value->>'id' = 'org-test-empty'), 'Roleless employees need an empty permissions array';
  reset role;
  delete from public.user_roles where user_id = 'f4000000-0000-4000-8000-000000000001';
  set local role authenticated;
  assert public.can_read_organizational_structure(), 'An active user without any role can still read the structure';
  reset role;
  insert into public.user_roles(user_id, role) values ('f4000000-0000-4000-8000-000000000001', 'admin');
  -- A stale JWT cannot bypass an Auth ban, even while has_role still returns true.
  update auth.users set banned_until = now() + interval '1 day' where id = 'f4000000-0000-4000-8000-000000000001';
  set local role authenticated;
  assert public.has_role('admin');
  assert not public.can_read_organizational_structure();
  rejected := false;
  begin perform public.get_organizational_structure();
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'Banned Admin must be refused';
  assert not exists(select 1 from public.divisions), 'Banned Admin cannot bypass through divisions';
  reset role;
  update auth.users set banned_until = now() + interval '1 day' where id = 'f4000000-0000-4000-8000-000000000002';
  perform set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000002', true);
  set local role authenticated;
  assert not public.can_read_organizational_structure(), 'Banned non-admin must be refused';
  assert not exists(select 1 from public.divisions), 'Banned non-admin cannot read divisions';
  reset role;
  update auth.users set banned_until = null where id = 'f4000000-0000-4000-8000-000000000002';
  perform set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000001', true);
  set local role authenticated;
  reset role;
  update auth.users set banned_until = now() - interval '1 day' where id = 'f4000000-0000-4000-8000-000000000001';
  set local role authenticated;
  assert public.can_read_organizational_structure(), 'Expired bans do not deactivate an Admin';
  reset role;
  update auth.users set deleted_at = now() where id = 'f4000000-0000-4000-8000-000000000001';
  set local role authenticated;
  assert not public.can_read_organizational_structure(), 'Auth-deleted Admin must be refused';
  reset role;
  update auth.users set deleted_at = null where id = 'f4000000-0000-4000-8000-000000000001';
  update public.profiles set deleted_at = now() where id = 'f4000000-0000-4000-8000-000000000001';
  set local role authenticated;
  rejected := false;
  begin perform public.get_organizational_structure();
  exception when insufficient_privilege then rejected := true;
  end;
  assert rejected, 'Deleted admin must be refused';
  assert not exists(select 1 from public.divisions);
  reset role;
  -- An Admin whose home department is removed can still inspect an empty chart.
  update public.profiles set deleted_at = null where id = 'f4000000-0000-4000-8000-000000000001';
  update public.departments set removed_at = now();
  update public.divisions set is_active = false;
  set local role authenticated;
  snapshot := public.get_organizational_structure();
  assert snapshot->'departments' = '[]'::jsonb and snapshot->'divisions' = '[]'::jsonb;
end;
$$;
rollback;
