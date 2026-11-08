-- Tests for 20261109120000_department_delete_requires_no_sops.sql. Only for a disposable LOCAL database with
-- every migration applied; never the shared project. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text, p_message text default null) returns void
language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute p_sql;
  exception when others then
    if sqlstate <> p_state or (p_message is not null and sqlerrm <> p_message) then raise; end if;
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

-- One admin (in dd-home); one department per case, none with employees.
insert into public.divisions(id, name) values ('dd-division', 'DD Division'), ('dd-empty-division', 'DD Empty Division');
insert into public.departments(id, name, initials, division_id) values
  ('dd-home', 'DD Home', 'DH', 'dd-division'),
  ('dd-draft', 'DD Draft', 'DR', 'dd-division'),
  ('dd-in-review', 'DD In Review', 'DI', 'dd-division'),
  ('dd-in-approval', 'DD In Approval', 'DQ', 'dd-division'),
  ('dd-approved', 'DD Approved', 'DB', 'dd-division'),
  ('dd-returned', 'DD Returned', 'DT', 'dd-division'),
  ('dd-published', 'DD Published', 'DP', 'dd-division'),
  ('dd-leftover', 'DD Leftover', 'DL', 'dd-division'),
  ('dd-none', 'DD None', 'DN', 'dd-division'),
  ('dd-pending', 'DD Pending', 'DG', 'dd-division');
insert into auth.users(id) values ('96000000-0000-4000-8000-000000000001');
insert into public.profiles(id, full_name, email, initials, department_id, "position")
  values ('96000000-0000-4000-8000-000000000001', 'DD Admin', 'dd-admin@test.invalid', 'DA', 'dd-home', 'Administrator');
insert into public.user_roles(user_id, role) values ('96000000-0000-4000-8000-000000000001', 'admin');

do $$
declare
  admin constant text := '96000000-0000-4000-8000-000000000001';
  v_status public.sop_status;
  v_sop uuid; v_job uuid; v_stamp timestamptz; v_department text;
  blocked constant text := 'Departments with SOPs cannot be deleted.';
begin
  -- ---------- signatures and grants unchanged ----------
  assert to_regprocedure('public.delete_department(text,text,timestamptz)') is not null;
  assert to_regprocedure('public.begin_department_file_deletion(text,timestamptz)') is not null;
  assert not has_function_privilege('anon', 'public.delete_department(text,text,timestamptz)', 'execute');
  assert has_function_privilege('authenticated', 'public.delete_department(text,text,timestamptz)', 'execute');

  -- ---------- an SOP in any status blocks every option of both entry points ----------
  foreach v_status in array array['draft', 'in-review', 'in-approval', 'approved', 'returned', 'published']::public.sop_status[] loop
    v_department := 'dd-' || v_status::text;
    perform pg_temp.as_owner();
    insert into public.sops(title, department_id, author_id, status, current_version)
      values ('DD ' || v_status, v_department, admin::uuid, v_status, 1);
    perform pg_temp.act_as(admin);
    select updated_at into v_stamp from public.departments where id = v_department;
    perform pg_temp.expect_error(format($q$select public.delete_department(%L, 'empty', %L)$q$, v_department, v_stamp), '23503', blocked);
    perform pg_temp.expect_error(format($q$select public.delete_department(%L, 'others', %L)$q$, v_department, v_stamp), '23503', blocked);
    perform pg_temp.expect_error(format($q$select public.begin_department_file_deletion(%L, %L)$q$, v_department, v_stamp), '23503', blocked);
    -- 'delete' still goes only through the cleanup endpoint.
    perform pg_temp.expect_error(format($q$select public.delete_department(%L, 'delete', %L)$q$, v_department, v_stamp), '23514');
    perform pg_temp.as_owner();
    assert (select removed_at is null and deletion_job_id is null from public.departments where id = v_department), 'Department kept: ' || v_status;
    assert not exists (select 1 from public.sops where department_id = v_department and (deleted_at is not null or directory_group <> 'department')),
      'SOPs untouched: ' || v_status;
  end loop;
  assert not exists (select 1 from public.department_file_deletions where department_id like 'dd-%'), 'No cleanup job started';

  -- ---------- "Deleted SOP" leftovers (deleted_at set) don't count ----------
  perform pg_temp.as_owner();
  -- Marked as 20261107120200's begin_department_file_deletion() marks them.
  insert into public.sops(title, department_id, author_id, status, current_version)
    values ('DD leftover', 'dd-leftover', admin::uuid, 'published', 1) returning id into v_sop;
  update public.sops set title = 'Deleted SOP', description = '', deleted_at = now() where id = v_sop;
  perform pg_temp.act_as(admin);
  select updated_at into v_stamp from public.departments where id = 'dd-leftover';
  perform public.delete_department('dd-leftover', 'empty', v_stamp);
  perform pg_temp.as_owner();
  assert (select removed_at is not null and division_id is null from public.departments where id = 'dd-leftover'), 'Leftovers only: deleted';

  -- ---------- a department without SOPs is deleted as before ----------
  perform pg_temp.act_as(admin);
  select updated_at into v_stamp from public.departments where id = 'dd-none';
  perform public.delete_department('dd-none', 'empty', v_stamp);
  perform pg_temp.as_owner();
  assert (select removed_at is not null from public.departments where id = 'dd-none'), 'No SOPs: deleted';

  -- ---------- employees are still reported first ----------
  update public.profiles set department_id = 'dd-draft' where id = admin::uuid;
  perform pg_temp.act_as(admin);
  select updated_at into v_stamp from public.departments where id = 'dd-draft';
  perform pg_temp.expect_error(format($q$select public.delete_department('dd-draft', 'empty', %L)$q$, v_stamp), '23503',
    'Departments with assigned employees cannot be deleted.');
  perform pg_temp.as_owner();
  update public.profiles set department_id = 'dd-home' where id = admin::uuid;

  -- ---------- a cleanup confirmed before this migration can still be retried ----------
  -- As 20261107120200's begin_department_file_deletion() left it: SOP marked deleted, job linked.
  insert into public.sops(title, department_id, author_id, status, current_version)
    values ('DD pending', 'dd-pending', admin::uuid, 'published', 1) returning id into v_sop;
  insert into public.department_file_deletions(department_id, requested_by, sop_ids)
    values ('dd-pending', admin::uuid, array[v_sop]) returning id into v_job;
  update public.sops set title = 'Deleted SOP', description = '', deleted_at = now() where id = v_sop;
  update public.departments set deletion_job_id = v_job, updated_at = clock_timestamp() where id = 'dd-pending';
  perform pg_temp.act_as(admin);
  select updated_at into v_stamp from public.departments where id = 'dd-pending';
  assert public.begin_department_file_deletion('dd-pending', v_stamp) = v_job, 'Retry returns the existing job';
  perform pg_temp.as_owner();
  -- No live SOP can join a department waiting on cleanup (guard_active_department), so a retry is never blocked.
  perform pg_temp.expect_error($q$insert into public.sops(title, department_id, author_id, status, current_version)
    values ('DD late', 'dd-pending', '96000000-0000-4000-8000-000000000001', 'draft', 1)$q$, '23514');

  -- ---------- division deletion is unchanged ----------
  perform pg_temp.act_as(admin);
  select updated_at into v_stamp from public.divisions where id = 'dd-division';
  perform pg_temp.expect_error(format($q$select public.delete_division('dd-division', %L)$q$, v_stamp), '23503');
  select updated_at into v_stamp from public.divisions where id = 'dd-empty-division';
  perform public.delete_division('dd-empty-division', v_stamp);
  perform pg_temp.as_owner();
  assert (select is_active = false from public.divisions where id = 'dd-empty-division'), 'An empty division is still deleted';
end;
$$;

rollback;
