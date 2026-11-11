-- Tests for 20261107140000_save_user.sql. Only for a disposable LOCAL Supabase/PostgreSQL database
-- with every migration applied; never run it against the shared Supabase project. Everything is
-- rolled back. Two admins acting at the same moment need two connections, so that isn't covered here.
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
-- A save_user call that keeps the name, phone and position.
create function pg_temp.call(p_user uuid, p_department text, p_roles text[], p_expected_department text, p_expected_roles text[], p_name text default 'SU Person') returns text
language sql as $$
  select format('select public.save_user(%L::uuid, %L, ''+966512345678'', ''Title'', %L, %L::text[], %L, %L::text[])',
    p_user, p_name, p_department, p_roles, p_expected_department, p_expected_roles);
$$;
create function pg_temp.roles(p_user uuid) returns text[]
language sql as $$
  select coalesce(array_agg(r.role::text order by r.role::text), '{}') from public.user_roles r where r.user_id = p_user;
$$;
create function pg_temp.titles(p_user uuid) returns text[]
language sql as $$
  select array_agg(e.title order by e.sort_order, e.title) from public.employee_positions e where e.profile_id = p_user;
$$;
-- An SOP, with its first version.
create function pg_temp.sop(p_author uuid, p_status public.sop_status, p_department text) returns uuid
language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.sops (id, title, department_id, author_id, status, current_version) values (v_id, 'SU SOP', p_department, p_author, p_status, 1);
  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values (v_id, 1, 'a.pdf', 'pdf', p_author || '/' || v_id || '.pdf', 1, p_author);
  return v_id;
end;
$$;
create function pg_temp.request(p_sop uuid, p_requester uuid, p_reviewer uuid, p_status public.review_request_status) returns void
language plpgsql as $$
declare v_round uuid;
begin
  select r.id into v_round from public.review_rounds r where r.sop_id = p_sop;
  if v_round is null then
    insert into public.review_rounds (sop_id, version, requested_by) values (p_sop, 1, p_requester) returning id into v_round;
  end if;
  insert into public.review_requests (round_id, sop_id, reviewer_id, status) values (v_round, p_sop, p_reviewer, p_status);
end;
$$;

insert into public.divisions (id, name) values ('su-a', 'SU Division A'), ('su-b', 'SU Division B');
insert into public.departments (id, name, initials, division_id) values
  ('su-home', 'SU Home', 'SH', 'su-a'), ('su-other', 'SU Other', 'SO', 'su-b'), ('su-gone', 'SU Gone', 'SG', 'su-a');
-- A database may already have its one Quality department.
insert into public.departments (id, name, initials, is_quality)
select 'su-quality', 'SU Quality', 'SQ', true where not exists (select 1 from public.departments where is_quality);
-- 1 and 2 admins, 3 banned admin, 4 author, 5 reviewer, 6 no role, 7 deleted, 8 Approver.
insert into auth.users (id) select ('97000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 8) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
select ('97000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'SU Person', 'su-' || n || '@test.invalid', 'SP',
  case when n = 8 then (select id from public.departments where is_quality) else 'su-home' end, '+966512345678', 'Title'
from generate_series(1, 8) n;
insert into public.user_roles (user_id, role) values
  ('97000000-0000-4000-8000-000000000001', 'admin'), ('97000000-0000-4000-8000-000000000002', 'admin'),
  ('97000000-0000-4000-8000-000000000003', 'admin'), ('97000000-0000-4000-8000-000000000004', 'author'),
  ('97000000-0000-4000-8000-000000000005', 'reviewer'), ('97000000-0000-4000-8000-000000000008', 'approver');
update auth.users set banned_until = now() + interval '1 day' where id = '97000000-0000-4000-8000-000000000003';
update public.profiles set deleted_at = now() where id = '97000000-0000-4000-8000-000000000007';
update public.departments set removed_at = now() where id = 'su-gone';

do $$
declare
  admin1 constant uuid := '97000000-0000-4000-8000-000000000001';
  admin2 constant uuid := '97000000-0000-4000-8000-000000000002';
  banned constant uuid := '97000000-0000-4000-8000-000000000003';
  author constant uuid := '97000000-0000-4000-8000-000000000004';
  reviewer constant uuid := '97000000-0000-4000-8000-000000000005';
  plain constant uuid := '97000000-0000-4000-8000-000000000006';
  gone constant uuid := '97000000-0000-4000-8000-000000000007';
  approver constant uuid := '97000000-0000-4000-8000-000000000008';
  quality text;
  status_value public.review_request_status;
  sop_status_value public.sop_status;
  v_sop uuid;
  v_second uuid;
  result jsonb;
  person public.profiles;
begin
  select id into quality from public.departments where is_quality;

  -- ---------- Who can call it ----------
  assert not has_function_privilege('anon', 'public.save_user(uuid, text, text, text, text, text[], text, text[])', 'execute');
  assert not has_function_privilege('service_role', 'public.save_user(uuid, text, text, text, text, text[], text, text[])', 'execute');
  assert has_function_privilege('authenticated', 'public.save_user(uuid, text, text, text, text, text[], text, text[])', 'execute');
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{author}', 'su-home', '{}'), '42501');
  perform pg_temp.act_as(banned);
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{author}', 'su-home', '{}'), '42501');
  -- The browser still can't change the tables directly, even as an admin.
  perform pg_temp.act_as(admin1);
  perform pg_temp.expect_error(format('insert into public.user_roles (user_id, role) values (%L, ''author'')', plain), '42501');
  perform pg_temp.expect_error(format('delete from public.user_roles where user_id = %L', author), '42501');
  perform pg_temp.expect_error(format('update public.profiles set department_id = ''su-other'' where id = %L', plain), '42501');

  -- ---------- What it refuses ----------
  -- A deactivated staff member is found (Edit Staff on the Deactive Staff tab) and stays deactivated.
  execute pg_temp.call(gone, 'su-home', '{}', 'su-home', '{}');
  assert (select deleted_at is not null from public.profiles where id = gone), 'Saving never reactivates';
  perform pg_temp.expect_error(pg_temp.call(gen_random_uuid(), 'su-home', '{}', 'su-home', '{}'), 'P0002');
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{owner}', 'su-home', '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', null, 'su-home', '{}'), '23514', 'invalid');
  perform pg_temp.expect_error(pg_temp.call(plain, null, '{}', 'su-home', '{}'), '23514', 'invalid');
  -- Someone else changed the department or roles since the form loaded.
  -- A stale save: hint 'conflict' (P0001), never 40001, which PostgREST 14 retries until it times out
  -- (20261112120000_staff_deactivation.sql).
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{author}', 'su-other', '{}'), 'P0001', 'conflict');
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{author}', 'su-home', '{reviewer}'), 'P0001', 'conflict');
  -- Own Admin, and Admin combined with other roles.
  perform pg_temp.expect_error(pg_temp.call(admin1, 'su-home', '{}', 'su-home', '{admin}'), '23514', 'self-admin');
  perform pg_temp.expect_error(pg_temp.call(admin1, 'su-home', '{author}', 'su-home', '{admin}'), '23514', 'self-admin');
  perform pg_temp.expect_error(pg_temp.call(admin1, 'su-home', '{admin,author}', 'su-home', '{admin}'), '23514', 'admin-exclusive');
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{admin,reviewer}', 'su-home', '{}'), '23514', 'admin-exclusive');
  -- Departments and Approver.
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-gone', '{}', 'su-home', '{}'), '23514', 'department-unavailable');
  perform pg_temp.expect_error(pg_temp.call(plain, 'nowhere', '{}', 'su-home', '{}'), '23514', 'department-unavailable');
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{approver}', 'su-home', '{}'), '23514', 'approver-quality');
  perform pg_temp.expect_error(pg_temp.call(approver, 'su-home', '{approver}', quality, '{approver}'), '23514', 'approver-quality');
  -- Invalid details, from update_user_details.
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{author}', 'su-home', '{}', repeat('n', 101)), '23514');
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{author}', 'su-home', '{}', '   '), '23514');

  -- All or nothing: the refused saves above changed nothing.
  perform pg_temp.as_owner();
  assert pg_temp.roles(plain) = '{}', 'A refused save added a role';
  assert pg_temp.roles(approver) = '{approver}';
  assert (select department_id from public.profiles where id = plain) = 'su-home';
  assert (select full_name from public.profiles where id = plain) = 'SU Person';

  -- ---------- Adding and removing permissions ----------
  perform pg_temp.act_as(admin1);
  result := public.save_user(plain, '  Rana Saleh  ', '+966598765432', ' New Title ', 'su-home', array['reviewer', 'author', 'author'], 'su-home', '{}');
  assert result->>'name' = 'Rana Saleh' and result->>'initials' = 'RS' and result->>'phone' = '+966598765432' and result->>'position' = 'New Title', result::text;
  assert result->>'departmentId' = 'su-home' and result->'permissions' = '["author", "reviewer"]'::jsonb, result::text;
  perform pg_temp.as_owner();
  assert pg_temp.roles(plain) = '{author,reviewer}';
  select * into person from public.profiles where id = plain;
  assert person.full_name = 'Rana Saleh' and person.email = 'su-6@test.invalid', 'Email is not changed';
  -- An unticked permission is gone from the table.
  perform pg_temp.act_as(admin1);
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'New Title', 'su-home', '{reviewer}', 'su-home', '{author,reviewer}');
  perform pg_temp.as_owner();
  assert pg_temp.roles(plain) = '{reviewer}';
  assert not exists (select 1 from public.user_roles where user_id = plain and role = 'author');
  -- The order of the roles doesn't matter.
  perform pg_temp.act_as(admin1);
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'New Title', 'su-home', '{}', 'su-home', '{reviewer}');
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'New Title', 'su-home', '{reviewer,author}', 'su-home', '{}');
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'New Title', 'su-home', '{}', 'su-home', '{reviewer,author}');

  -- Admins are managed on Manage Organization → Admins (20261111120000_super_admin.sql): Staff can't
  -- remove another admin's Admin, or give the Admin permission to staff.
  perform pg_temp.expect_error(pg_temp.call(admin2, 'su-home', '{}', 'su-home', '{admin}'), '23514', 'admin-managed-separately');
  perform pg_temp.as_owner();
  assert pg_temp.roles(admin2) = '{admin}', 'A refused save changed the roles';
  perform pg_temp.act_as(admin1);
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'New Title', 'su-home', '{author,reviewer}', 'su-home', '{}');
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{admin}', 'su-home', '{author,reviewer}'), '23514', 'admin-managed-separately');
  perform pg_temp.as_owner();
  assert pg_temp.roles(plain) = '{author,reviewer}', 'A refused promotion kept the other roles';
  perform pg_temp.act_as(admin1);
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'New Title', 'su-home', '{}', 'su-home', '{author,reviewer}');

  -- ---------- Approver and Quality, in one save ----------
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'New Title', quality, '{approver}', 'su-home', '{}');
  perform pg_temp.as_owner();
  assert pg_temp.roles(plain) = '{approver}' and (select department_id from public.profiles where id = plain) = quality;
  perform pg_temp.act_as(admin1);
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'New Title', 'su-home', '{}', quality, '{approver}');
  perform pg_temp.as_owner();
  assert pg_temp.roles(plain) = '{}' and (select department_id from public.profiles where id = plain) = 'su-home';

  -- ---------- Department: positions and division ----------
  perform pg_temp.act_as(admin1);
  perform public.set_employee_positions(plain, array['New Title', 'Second', 'Third']);
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'New Title', 'su-other', '{}', 'su-home', '{}');
  perform pg_temp.as_owner();
  assert pg_temp.titles(plain) = array['New Title'], pg_temp.titles(plain)::text;
  assert (select e.department_id from public.employee_positions e where e.profile_id = plain) = 'su-other';
  assert exists (select 1 from public.organization_management_audit a
    where a.action = 'save-user' and a.entity_id = plain::text and a.actor_id = admin1
      and a.details->>'departmentBefore' = 'su-home' and a.details->>'departmentAfter' = 'su-other'
      and a.details->'positionsInOldDepartment' = '["New Title", "Second", "Third"]'::jsonb), 'Removed titles are kept in the audit row';
  -- The division follows the department: nothing else stores it.
  assert (select d.division_id from public.profiles p join public.departments d on d.id = p.department_id where p.id = plain) = 'su-b';
  -- Changing the position and the department together.
  perform pg_temp.act_as(admin1);
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'Moved Title', 'su-home', '{}', 'su-other', '{}');
  perform pg_temp.as_owner();
  assert pg_temp.titles(plain) = array['Moved Title'], pg_temp.titles(plain)::text;
  assert (select "position" from public.profiles where id = plain) = 'Moved Title';
  -- Your own account can be saved. A System Admin's department isn't edited here (20261110120000):
  -- whatever department is sent, theirs is kept.
  perform pg_temp.act_as(admin1);
  perform public.save_user(admin1, 'SU Person', '+966512345678', 'Title', 'su-other', '{admin}', 'su-home', '{admin}');
  perform pg_temp.as_owner();
  assert (select department_id from public.profiles where id = admin1) = 'su-home', 'A System Admin''s department was edited';
  perform pg_temp.act_as(admin1);

  -- ---------- Author in use ----------
  perform pg_temp.as_owner();
  foreach sop_status_value in array array['draft', 'in-review', 'returned', 'in-approval', 'approved']::public.sop_status[] loop
    v_sop := pg_temp.sop(author, sop_status_value, 'su-home');
    perform pg_temp.act_as(admin1);
    perform pg_temp.expect_error(pg_temp.call(author, 'su-home', '{}', 'su-home', '{author}'), '23514', 'permission-in-use');
    perform pg_temp.as_owner();
    update public.sops set status = 'published' where id = v_sop;
  end loop;
  -- Only published SOPs left: allowed.
  perform pg_temp.act_as(admin1);
  perform public.save_user(author, 'SU Person', '+966512345678', 'Title', 'su-home', '{}', 'su-home', '{author}');
  perform public.save_user(author, 'SU Person', '+966512345678', 'Title', 'su-home', '{author}', 'su-home', '{}');
  -- A co-author counts, and a deleted SOP doesn't.
  perform pg_temp.as_owner();
  insert into public.user_roles (user_id, role) values (plain, 'author');
  insert into public.user_roles (user_id, role) values (reviewer, 'author');
  v_sop := pg_temp.sop(reviewer, 'draft', 'su-home');
  insert into public.sop_co_authors (sop_id, user_id, added_by) values (v_sop, plain, reviewer);
  perform pg_temp.act_as(admin1);
  perform pg_temp.expect_error(pg_temp.call(plain, 'su-home', '{}', 'su-home', '{author}', 'Rana Saleh'), '23514', 'permission-in-use');
  perform pg_temp.as_owner();
  delete from public.sop_co_authors c where c.user_id = plain;
  v_second := pg_temp.sop(plain, 'draft', 'su-home');
  update public.sops set deleted_at = now() where id = v_second;
  perform pg_temp.act_as(admin1);
  perform public.save_user(plain, 'Rana Saleh', '+966598765432', 'Moved Title', 'su-home', '{}', 'su-home', '{author}');
  perform pg_temp.as_owner();
  update public.sops set status = 'published' where id = v_sop;
  delete from public.user_roles where user_id = reviewer and role = 'author';

  -- ---------- Reviewer in use, as the browser's sopsUsing and legacyDecision ----------
  foreach status_value in array array['pending', 'accepted', 'completed', 'returned']::public.review_request_status[] loop
    v_sop := pg_temp.sop(author, 'in-review', 'su-home');
    perform pg_temp.request(v_sop, author, reviewer, status_value);
    perform pg_temp.act_as(admin1);
    perform pg_temp.expect_error(pg_temp.call(reviewer, 'su-home', '{}', 'su-home', '{reviewer}'), '23514', 'permission-in-use');
    perform pg_temp.as_owner();
    update public.sops set status = 'published' where id = v_sop;
  end loop;
  foreach status_value in array array['declined', 'withdrawn', 'removed', 'expired']::public.review_request_status[] loop
    v_sop := pg_temp.sop(author, 'in-review', 'su-home');
    perform pg_temp.request(v_sop, author, reviewer, status_value);
    perform pg_temp.act_as(admin1);
    perform public.save_user(reviewer, 'SU Person', '+966512345678', 'Title', 'su-home', '{}', 'su-home', '{reviewer}');
    perform public.save_user(reviewer, 'SU Person', '+966512345678', 'Title', 'su-home', '{reviewer}', 'su-home', '{}');
    perform pg_temp.as_owner();
    update public.sops set status = 'published' where id = v_sop;
  end loop;
  -- Their latest request counts: a request sent again blocks, a later cancellation doesn't.
  v_sop := pg_temp.sop(author, 'in-review', 'su-home');
  perform pg_temp.request(v_sop, author, reviewer, 'expired');
  perform pg_temp.request(v_sop, author, reviewer, 'pending');
  perform pg_temp.act_as(admin1);
  perform pg_temp.expect_error(pg_temp.call(reviewer, 'su-home', '{}', 'su-home', '{reviewer}'), '23514', 'permission-in-use');
  perform pg_temp.as_owner();
  perform pg_temp.request(v_sop, author, reviewer, 'removed');
  perform pg_temp.act_as(admin1);
  perform public.save_user(reviewer, 'SU Person', '+966512345678', 'Title', 'su-home', '{}', 'su-home', '{reviewer}');
  perform public.save_user(reviewer, 'SU Person', '+966512345678', 'Title', 'su-home', '{reviewer}', 'su-home', '{}');
  -- A draft or published SOP doesn't block, and the counts are in the error's detail.
  perform pg_temp.as_owner();
  update public.sops set status = 'published' where id = v_sop;
  v_sop := pg_temp.sop(author, 'in-review', 'su-home');
  v_second := pg_temp.sop(author, 'approved', 'su-home');
  perform pg_temp.request(v_sop, author, reviewer, 'accepted');
  perform pg_temp.request(v_second, author, reviewer, 'completed');
  perform pg_temp.act_as(admin1);
  begin
    perform public.save_user(reviewer, 'SU Person', '+966512345678', 'Title', 'su-home', '{}', 'su-home', '{reviewer}');
    assert false, 'Expected permission-in-use';
  exception when check_violation then
    declare v_detail text;
    begin
      get stacked diagnostics v_detail = pg_exception_detail;
      assert v_detail = 'reviewer:2', 'Detail: ' || coalesce(v_detail, '(none)');
    end;
  end;

  -- ---------- A move during a review: refused (20261110120000, department transfer restriction) ----------
  -- A reviewer who completed their review is still responsible while the SOP is in progress (a
  -- returned SOP comes back to them), so they can't move, and has_home_finished can't flip.
  perform pg_temp.as_owner();
  update public.sops set status = 'published' where id = v_second;
  v_sop := pg_temp.sop(author, 'in-review', 'su-home');
  perform pg_temp.request(v_sop, author, reviewer, 'completed');
  assert public.has_home_finished((select r.id from public.review_rounds r where r.sop_id = v_sop));
  perform pg_temp.act_as(admin1);
  perform pg_temp.expect_error(pg_temp.call(reviewer, 'su-other', '{reviewer}', 'su-home', '{reviewer}'), '23514', 'department-transfer-blocked');
  perform pg_temp.as_owner();
  assert (select department_id from public.profiles where id = reviewer) = 'su-home', 'The reviewer moved';
  assert public.has_home_finished((select r.id from public.review_rounds r where r.sop_id = v_sop)), 'The review result changed';

  -- ---------- The last admin: can't be reached while the caller's own Admin counts ----------
  -- Replaced inside this transaction only, to reach the rule directly.
  delete from public.user_roles where role = 'admin' and user_id <> admin1;
  execute 'create or replace function public.can_manage_organization() returns boolean language sql stable security definer set search_path = '''' as $f$ select true $f$';
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(pg_temp.call(admin1, 'su-home', '{}', 'su-home', '{admin}'), '23514', 'last-admin');
  perform pg_temp.as_owner();
  -- A banned admin doesn't count as another admin.
  insert into public.user_roles (user_id, role) values (banned, 'admin');
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(pg_temp.call(admin1, 'su-home', '{}', 'su-home', '{admin}'), '23514', 'last-admin');
  perform pg_temp.as_owner();
end;
$$;

-- Runs the deferred position rules as a real commit would.
set constraints all immediate;
rollback;
