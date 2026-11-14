-- Tests for the Divisions & Departments migrations 20261107120000-20261107120300 (with 20261109120000:
-- a department with SOPs can't be deleted) and for the develop
-- behaviour they must keep. Only for a disposable LOCAL Supabase/PostgreSQL database with every migration
-- applied; never run it against the shared Supabase project. Everything is rolled back.
-- Optional: with the legacy rows from docs/divisions-departments.md ("Legacy fixtures") committed BEFORE
-- the migrations, the backfill checks at the end also run.
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
create function pg_temp.act_as(p_user text, p_role text default 'authenticated') returns void
language plpgsql as $$
begin
  perform set_config('role', p_role, true);
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

-- People: 1 admin, 2 author (not admin), 3 banned admin, 4 employee of the deletable department.
insert into public.divisions(id, name) values ('om-active', 'OM Active'), ('om-other', 'OM Other');
insert into public.divisions(id, name, is_active) values ('om-inactive', 'OM Inactive', false);
insert into public.departments(id, name, initials, division_id) values
  ('om-home', 'OM Home', 'OH', 'om-active'), ('om-delete', 'OM Delete', 'OD', 'om-active'), ('om-move', 'OM Move', 'OV', 'om-other');
insert into auth.users(id) select ('94000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 4) n;
insert into public.profiles(id, full_name, email, initials, department_id, "position")
select ('94000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'OM person ' || n, 'om-' || n || '@test.invalid', 'OP',
  case when n = 4 then 'om-delete' else 'om-home' end, 'Title ' || n
from generate_series(1, 4) n;
insert into public.user_roles(user_id, role) values
  ('94000000-0000-4000-8000-000000000001', 'admin'), ('94000000-0000-4000-8000-000000000002', 'author'),
  ('94000000-0000-4000-8000-000000000003', 'admin');
update auth.users set banned_until = now() + interval '1 day' where id = '94000000-0000-4000-8000-000000000003';

do $$
declare
  admin constant text := '94000000-0000-4000-8000-000000000001';
  author constant text := '94000000-0000-4000-8000-000000000002';
  banned constant text := '94000000-0000-4000-8000-000000000003';
  employee constant uuid := '94000000-0000-4000-8000-000000000004';
  v_division text; v_department text; v_stamp timestamptz; v_snapshot jsonb; v_row jsonb; v_job uuid; v_sop uuid; v_kept uuid;
begin
  -- ---------- develop is preserved ----------
  assert (select pg_get_functiondef('public.latest_round(uuid)'::regprocedure) like '%order by r.requested_at desc, r.id desc limit 1%'),
    'develop''s latest_round() must be unchanged';
  assert (select pg_get_functiondef('public.can_read_organizational_structure()'::regprocedure) like '%public.is_active_user()%'),
    'develop''s organizational-structure read rule (every active user) must be unchanged';
  assert (select not prosecdef from pg_proc where oid = 'public.get_organizational_structure()'::regprocedure), 'Chart RPC stays security invoker';
  assert not has_function_privilege('authenticated', 'public.delete_sop(uuid,uuid,text)', 'execute'), 'delete_sop stays Edge-Function only';
  assert has_function_privilege('service_role', 'public.delete_sop(uuid,uuid,text)', 'execute');
  assert has_column_privilege('authenticated', 'public.divisions', 'name', 'select');
  assert has_column_privilege('authenticated', 'public.divisions', 'description', 'select'), 'Existing division columns stay readable';
  assert not has_column_privilege('authenticated', 'public.divisions', 'email', 'select'), 'The new email column is not directly readable';

  -- A non-admin active employee still reads the organizational chart (develop behaviour).
  perform pg_temp.act_as(author);
  v_snapshot := public.get_organizational_structure();
  assert jsonb_path_exists(v_snapshot, '$.divisions[*] ? (@.id == "om-active")'), 'Chart lists divisions for active employees';
  perform pg_temp.as_owner();

  -- ---------- authorization ----------
  assert not has_function_privilege('anon', 'public.save_department(text,text,text,text,text,timestamptz,text)', 'execute');
  assert not has_function_privilege('anon', 'public.get_divisions_departments()', 'execute');
  perform pg_temp.act_as(author);
  assert not public.can_manage_organization(), 'An author is not an organization manager';
  perform pg_temp.expect_error($q$select public.save_department(null,'X','XX','',  'om-active')$q$, '42501');
  perform pg_temp.expect_error($q$select public.get_divisions_departments()$q$, '42501');
  perform pg_temp.act_as(banned);
  assert not public.can_manage_organization(), 'A banned admin is refused';

  -- ---------- divisions: email optional ----------
  perform pg_temp.act_as(admin);
  assert public.can_manage_organization();
  v_division := public.save_division(null, 'OM New Division', 'Desc', null);
  -- The admin's direct read of email is refused (column grant); the snapshot carries it.
  perform pg_temp.expect_error(format($q$select email from public.divisions where id = %L$q$, v_division), '42501');
  assert jsonb_path_exists(public.get_divisions_departments(), '$.divisions[*] ? (@.name == "OM New Division" && @.email == null)'), 'Division without email';
  select updated_at into v_stamp from public.divisions where id = v_division;
  perform public.save_division(v_division, 'OM New Division', 'Desc', '   ', v_stamp);
  assert jsonb_path_exists(public.get_divisions_departments(), '$.divisions[*] ? (@.name == "OM New Division" && @.email == null)'), 'Blank email is stored as none';
  select updated_at into v_stamp from public.divisions where id = v_division;
  perform public.save_division(v_division, 'OM New Division', 'Desc', 'team@hawkim.test', v_stamp);
  assert jsonb_path_exists(public.get_divisions_departments(), '$.divisions[*] ? (@.name == "OM New Division" && @.email == "team@hawkim.test")');
  select updated_at into v_stamp from public.divisions where id = v_division;
  perform pg_temp.expect_error(format($q$select public.save_division(%L,'OM New Division','', 'not-an-email', %L)$q$, v_division, v_stamp), '23514');

  -- ---------- departments: create/edit with the division ----------
  perform pg_temp.expect_error($q$select public.save_department(null,'OM No Division','ND','',null)$q$, '23514');
  perform pg_temp.expect_error($q$select public.save_department(null,'OM Inactive','IN','','om-inactive')$q$, '23514');
  perform pg_temp.expect_error($q$select public.save_department(null,'OM Bad','B1','','om-active')$q$, '23514');
  perform pg_temp.expect_error($q$select public.save_department(null,'om home','ZZ','','om-active')$q$, '23505');
  v_department := public.save_department(null, ' OM Created ', 'oc', ' About ', v_division);
  assert v_department like 'department-%';
  assert (select division_id = v_division and name = 'OM Created' and initials = 'OC' and description = 'About'
    from public.departments where id = v_department), 'Created in its division, normalized';
  select updated_at into v_stamp from public.departments where id = v_department;
  perform pg_temp.expect_error(format($q$select public.save_department(%L,'OM Created','OC','',%L,%L)$q$, v_department, 'om-active', v_stamp - interval '1 second'), 'P0001');
  perform public.save_department(v_department, 'OM Renamed', 'OR', '', 'om-active', v_stamp);
  assert (select division_id = 'om-active' and name = 'OM Renamed' from public.departments where id = v_department), 'Edit moves it to another division';
  -- The admin's own division cannot be deleted while it has departments.
  select updated_at into v_stamp from public.divisions where id = 'om-active';
  perform pg_temp.expect_error(format($q$select public.delete_division('om-active', %L)$q$, v_stamp), '23503');

  -- The admin snapshot carries the division, positions and totals.
  v_snapshot := public.get_divisions_departments();
  select d into v_row from jsonb_array_elements(v_snapshot -> 'departments') d where d ->> 'id' = 'om-home';
  assert v_row ->> 'division_id' = 'om-active';
  assert (v_row -> 'employees')::int = 3 and jsonb_array_length(v_row -> 'people') = 3, 'All active members are listed';
  assert jsonb_path_exists(v_row, '$.people[*] ? (@.name == "OM person 1").positions[*] ? (@ == "Title 1")'), 'Positions come from profiles.position';
  select d into v_row from jsonb_array_elements(v_snapshot -> 'divisions') d where d ->> 'id' = 'om-active';
  assert (v_row ->> 'department_count')::int = 3, 'Division totals count its departments';

  -- ---------- positions ----------
  perform public.set_employee_positions(employee, array['  Lead ', 'Trainer', 'lead']);
  assert (select "position" = 'Lead' from public.profiles where id = employee), 'The first title is the primary position';
  assert (select array_agg(title order by sort_order) = array['Lead', 'Trainer'] from public.employee_positions where profile_id = employee), 'Trimmed, de-duplicated, ordered';
  perform pg_temp.expect_error(format($q$select public.set_employee_positions(%L, array['  '])$q$, employee), '23514');

  -- ---------- department deletion and storage cleanup ----------
  perform pg_temp.as_owner();
  -- Two SOPs: one with a real path, a blank path and a deleted version; files exist in storage.
  insert into public.sops(id, title, department_id, author_id, status, current_version)
    values (gen_random_uuid(), 'OM SOP', 'om-delete', employee, 'draft', 1) returning id into v_sop;
  insert into public.sop_versions(sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by) values
    (v_sop, 1, 'v1.pdf', 'pdf', 'om/' || v_sop || '/1.pdf', 100, employee),
    (v_sop, 2, 'v2.pdf', 'pdf', '   ', 100, employee);
  insert into storage.objects(bucket_id, name) values ('sop-files', 'om/' || v_sop || '/1.pdf');
  insert into public.user_roles(user_id, role) values (employee, 'author');

  perform pg_temp.act_as(admin);
  select updated_at into v_stamp from public.departments where id = 'om-delete';
  perform pg_temp.expect_error(format($q$select public.begin_department_file_deletion('om-delete', %L)$q$, v_stamp), '23503');
  perform pg_temp.expect_error(format($q$select public.delete_department('om-delete', 'delete', %L)$q$, v_stamp), '23514');
  -- Move the employee out (with a position in the new department) so the department can go.
  perform pg_temp.as_owner();
  -- A fixture shortcut past the department transfer restriction (20261110120000), which refuses moving
  -- someone with unfinished SOPs: their SOPs count as finished only for the move, then exactly as before.
  create temp table if not exists fixture_sop_statuses(id uuid primary key, status public.sop_status) on commit drop;
  delete from fixture_sop_statuses;
  insert into fixture_sop_statuses select s.id, s.status from public.sops s
    where s.deleted_at is null and s.status <> 'published' and s.author_id = employee;
  update public.sops s set status = 'published' from fixture_sop_statuses f where s.id = f.id;
  update public.profiles set department_id = 'om-home' where id = employee;
  update public.sops s set status = f.status from fixture_sop_statuses f where s.id = f.id;
  -- Its SOP still blocks the deletion (20261109120000), through both entry points and every option.
  perform pg_temp.act_as(admin);
  select updated_at into v_stamp from public.departments where id = 'om-delete';
  perform pg_temp.expect_error(format($q$select public.begin_department_file_deletion('om-delete', %L)$q$, v_stamp), '23503');
  perform pg_temp.expect_error(format($q$select public.delete_department('om-delete', 'others', %L)$q$, v_stamp), '23503');
  perform pg_temp.expect_error(format($q$select public.delete_department('om-delete', 'empty', %L)$q$, v_stamp), '23503');
  -- A deletion confirmed BEFORE 20261109120000 that is still waiting on file cleanup, as
  -- 20261107120200's begin_department_file_deletion() left it (only the real path queued).
  perform pg_temp.as_owner();
  insert into public.department_file_deletions(department_id, requested_by, sop_ids)
    values ('om-delete', admin::uuid, array[v_sop]) returning id into v_job;
  insert into public.department_file_deletion_items(job_id, bucket_id, storage_path) values (v_job, 'sop-files', 'om/' || v_sop || '/1.pdf');
  update public.sop_versions set file_name = 'deleted', deleted_at = coalesce(deleted_at, now()), deleted_by = coalesce(deleted_by, admin::uuid) where sop_id = v_sop;
  update public.sops set title = 'Deleted SOP', description = '', deleted_at = now(), updated_at = now() where id = v_sop;
  update public.departments set deletion_job_id = v_job, updated_at = clock_timestamp() where id = 'om-delete';
  -- Retrying it still works: the same job comes back, before the new SOP check.
  perform pg_temp.act_as(admin);
  select updated_at into v_stamp from public.departments where id = 'om-delete';
  assert public.begin_department_file_deletion('om-delete', v_stamp) = v_job, 'A pending cleanup can still be retried';
  perform pg_temp.as_owner();
  assert (select deleted_at is not null and title = 'Deleted SOP' from public.sops where id = v_sop), 'SOP retained as deleted';

  -- develop's delete_sop() can't erase the retained SOP; the attempt is rolled back as a whole.
  perform pg_temp.act_as(null, 'service_role');
  perform pg_temp.expect_error(format($q$select public.delete_sop(%L, %L, 'cleanup')$q$, employee, v_sop), '23514');
  perform pg_temp.as_owner();
  assert (select count(*) = 2 from public.sop_versions where sop_id = v_sop), 'Retained versions are still there';
  -- Nobody sees the retained SOP any more, not even its author.
  perform pg_temp.act_as(employee::text);
  assert not public.can_view_sop(v_sop), 'A retained SOP is hidden';

  -- The worker can't acknowledge a file that Storage still holds; then cleanup completes.
  perform pg_temp.act_as(null, 'service_role');
  v_row := public.claim_department_file_deletion(v_job);
  assert jsonb_array_length(v_row -> 'files') = 1;
  perform pg_temp.expect_error(format($q$select public.ack_department_file_deletion(%L, %L, array[%L], false)$q$,
    v_job, v_row ->> 'leaseToken', 'om/' || v_sop || '/1.pdf'), '23514');
  perform pg_temp.as_owner();
  -- Stands in for the Storage API removing the file (real Storage only allows this with the flag;
  -- the test stand-in has no such trigger). Rolled back with everything else.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where name = 'om/' || v_sop || '/1.pdf';
  perform set_config('storage.allow_delete_query', 'false', true);
  perform pg_temp.act_as(null, 'service_role');
  assert public.ack_department_file_deletion(v_job, (v_row ->> 'leaseToken')::uuid, array['om/' || v_sop || '/1.pdf'], false) = 'completed';
  perform pg_temp.as_owner();
  assert (select removed_at is not null and division_id is null from public.departments where id = 'om-delete'), 'Department removed after cleanup';

  -- Move to Others is refused while the department has SOPs (20261109120000).
  insert into public.sops(id, title, department_id, author_id, status, current_version)
    values (gen_random_uuid(), 'OM kept SOP', 'om-move', employee, 'draft', 1) returning id into v_kept;
  insert into public.sop_versions(sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
    values (v_kept, 1, 'k.pdf', 'pdf', 'om/' || v_kept || '/1.pdf', 100, employee);
  perform pg_temp.act_as(admin);
  select updated_at into v_stamp from public.departments where id = 'om-move';
  perform pg_temp.expect_error(format($q$select public.delete_department('om-move', 'empty', %L)$q$, v_stamp), '23503');
  perform pg_temp.expect_error(format($q$select public.delete_department('om-move', 'others', %L)$q$, v_stamp), '23503');
  perform pg_temp.as_owner();
  assert (select directory_group = 'department' and deleted_at is null from public.sops where id = v_kept), 'The SOP stays in its department';
  assert (select removed_at is null from public.departments where id = 'om-move'), 'The department stays';
  -- An SOP moved to Others BEFORE 20261109120000 (as delete_department(..., 'others') left it) stays visible to its author.
  update public.sops set directory_group = 'others', updated_at = now() where id = v_kept;
  update public.departments set removed_at = now(), division_id = null, updated_at = clock_timestamp() where id = 'om-move';
  assert (select directory_group = 'others' and deleted_at is null from public.sops where id = v_kept);
  perform pg_temp.act_as(employee::text);
  assert public.can_view_sop(v_kept), 'Its author still sees an SOP moved to Others';
  perform pg_temp.as_owner();

  -- ---------- develop's Request Hawkim still creates an Admin (without a department or position) ----------
  perform pg_temp.act_as(null, 'service_role');
  perform public.submit_access_request('OM Org', 'Request Person', 'Quality Lead', 'request@test.invalid', '+966500000000', 10, null, repeat('a', 64), 'info@organization.test', 'King Fahd Road, Riyadh', null, null, 'A test organization.');
  perform pg_temp.as_owner();
  insert into auth.users(id) values ('94000000-0000-4000-8000-000000000099');
  -- One organization per deployment (20261111120000_super_admin.sql): refused while this one has Admins…
  perform pg_temp.act_as(null, 'service_role');
  perform pg_temp.expect_error(format('select public.accept_access_request(%L, %L, %L, %L)',
    (select id from public.access_requests where email = 'request@test.invalid'), repeat('a', 64), '94000000-0000-4000-8000-000000000099', 'om-home'), 'P0001');
  -- …so it is accepted as on a new deployment (rolled back): no Super Admin and no active Admin.
  perform pg_temp.as_owner();
  alter table public.organizations disable trigger user;
  update public.organizations set super_admin_id = null, super_admin_assigned_at = null;
  alter table public.organizations enable trigger user;
  update public.profiles p set deleted_at = now()
  where p.deleted_at is null and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin');
  perform pg_temp.act_as(null, 'service_role');
  perform public.accept_access_request((select id from public.access_requests where email = 'request@test.invalid'), repeat('a', 64),
    '94000000-0000-4000-8000-000000000099', 'om-home');
  perform pg_temp.as_owner();
  assert (select o.super_admin_id from public.organizations o) = '94000000-0000-4000-8000-000000000099', 'The accepted requester is the Super Admin';
  set constraints all immediate; -- run the commit-time department and position checks now
  -- An Admin has no department and no position (20261112140000_admins_without_department.sql), so the
  -- request's job title isn't made a position.
  assert (select department_id is null and "position" is null from public.profiles where id = '94000000-0000-4000-8000-000000000099'),
    'The accepted requester has no department and no position';
  assert not exists (select 1 from public.employee_positions where profile_id = '94000000-0000-4000-8000-000000000099'),
    'The accepted requester holds no position row';

  -- ---------- legacy rows (only when the README fixtures were committed first) ----------
  if exists (select 1 from public.profiles where id = 'b7100000-0000-4000-8000-000000000001') then
    assert (select title = 'Pharmacist' from public.employee_positions where profile_id = 'b7100000-0000-4000-8000-000000000001'), 'Backfilled';
    assert not exists (select 1 from public.employee_positions where profile_id = 'b7100000-0000-4000-8000-000000000002'), 'No invented title';
    perform pg_temp.act_as(admin);
    select updated_at into v_stamp from public.departments where id = 'legacy-unassigned';
    perform public.save_department('legacy-unassigned', 'Legacy Unassigned', 'LU', '', null, v_stamp);
    perform pg_temp.as_owner();
    assert (select division_id is null from public.departments where id = 'legacy-unassigned'), 'A legacy department may stay unassigned';
    raise notice 'legacy checks ran';
  end if;
end;
$$;

rollback;
