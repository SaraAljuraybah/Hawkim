-- Tests for 20261116130000_conflict_without_retry.sql: no function refuses a conflict with SQLSTATE 40001
-- (which PostgREST 14 retries until it times out); a stale change is P0001 with hint 'conflict'.
-- Only for a disposable LOCAL database with every migration applied; never the shared project.
-- Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

-- The SQLSTATE and hint a statement fails with (null when it doesn't fail).
create function pg_temp.refusal(p_sql text) returns text
language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || ' ' || coalesce(v_hint, '');
end;
$$;
create function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end;
$$;
grant execute on function pg_temp.refusal(text), pg_temp.act_as(uuid) to public;

insert into auth.users (id, email) values ('97000000-0000-4000-8000-000000000001', 'conflict-admin@test.invalid');
insert into public.profiles (id, full_name, email, initials) values
  ('97000000-0000-4000-8000-000000000001', 'Conflict Admin', 'conflict-admin@test.invalid', 'CA');
insert into public.user_roles (user_id, role) values ('97000000-0000-4000-8000-000000000001', 'admin');
insert into public.divisions (id, name, description) values ('conflict-division', 'Conflict Division', '');
insert into public.departments (id, name, initials, division_id) values ('conflict-department', 'Conflict Department', 'CD', 'conflict-division');

do $$
declare
  stale constant timestamptz := '2000-01-01';
  v_job uuid := '97000000-0000-4000-8000-0000000000f1';
begin
  -- No function raises 40001 any more (save_user only mentions it in a comment).
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.prosrc ~ $r$errcode ?= ?'40001'$r$), 'A function still raises 40001';
  assert (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.prosrc like '%hint = ''conflict''%') >= 10, 'The conflicts are P0001 with hint conflict';

  perform pg_temp.act_as('97000000-0000-4000-8000-000000000001');
  -- A stale edit or delete: refused at once with the conflict.
  assert pg_temp.refusal(format('select public.save_division(%L, %L, %L, %L, %L)',
    'conflict-division', 'Conflict Division', 'Stale', '', stale)) = 'P0001 conflict', 'stale division edit';
  assert pg_temp.refusal(format('select public.delete_division(%L, %L)', 'conflict-division', stale)) = 'P0001 conflict',
    'stale division delete';
  assert pg_temp.refusal(format('select public.save_department(%L, %L, %L, %L, %L, %L, %L)',
    'conflict-department', 'Conflict Department', 'CD', '', 'conflict-division', stale, '')) = 'P0001 conflict',
    'stale department edit';
  assert pg_temp.refusal(format('select public.delete_department(%L, %L, %L)', 'conflict-department', 'empty', stale))
    = 'P0001 conflict', 'stale department delete';
  assert pg_temp.refusal(format('select public.begin_department_file_deletion(%L, %L)', 'conflict-department', stale))
    = 'P0001 conflict', 'stale department file deletion';
  assert pg_temp.refusal(format('select public.begin_department_file_deletion(%L, %L)', 'no-such-department', stale))
    = 'P0001 conflict', 'an unknown department';
  assert pg_temp.refusal(format('select public.get_department_file_deletion(%L)', v_job)) = 'P0001 conflict',
    'an unknown deletion job';
end;
$$;

rollback;
