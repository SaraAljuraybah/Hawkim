-- Tests for 20261112120000_staff_deactivation.sql: Delete Staff deactivates a staff member for real
-- (deactivate_staff), what a deactivated person can still reach (nothing), and Add Staff bringing a
-- deactivated staff member back (add_user reactivation). Every call is made as the API would make it
-- (role authenticated or anon, with the caller's id in the JWT claims), so these are the direct,
-- hand-crafted requests the browser can't stop.
-- Only for a disposable LOCAL database with every migration applied; never the shared project.
-- Everything is rolled back. Concurrency, real sign-in and the add-user Edge Function are covered by
-- staff_deactivation.local.mjs.
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
create function pg_temp.roles(p_user uuid) returns text[]
language sql as $$
  select coalesce(array_agg(r.role::text order by r.role::text), '{}') from public.user_roles r where r.user_id = p_user;
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(), pg_temp.roles(uuid) to public;

-- People: 1 Admin (the caller), 2 staff with a Draft (work in progress), 3 staff with only a published
-- SOP, 4 staff with no SOP, 5 another staff member, 6 another Admin, 7 the Super Admin.
insert into auth.users (id, email, aud, role)
select ('96000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'sd-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 7) n;
insert into public.departments (id, name, initials) values ('sd-home', 'SD Home', 'SH'), ('sd-other', 'SD Other', 'SO');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
select ('96000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'SD Person ' || n, 'sd-' || n || '@test.invalid', 'SP', 'sd-home',
  '+96651234560' || n, 'Officer'
from generate_series(1, 7) n;
insert into public.user_roles (user_id, role) values
  ('96000000-0000-4000-8000-000000000001', 'admin'),
  ('96000000-0000-4000-8000-000000000002', 'author'),
  ('96000000-0000-4000-8000-000000000003', 'author'),
  ('96000000-0000-4000-8000-000000000004', 'author'), ('96000000-0000-4000-8000-000000000004', 'reviewer'),
  ('96000000-0000-4000-8000-000000000005', 'reviewer'),
  ('96000000-0000-4000-8000-000000000006', 'admin'),
  ('96000000-0000-4000-8000-000000000007', 'admin');
-- The Super Admin designation, as a deployment has it (rolled back).
alter table public.organizations disable trigger user;
update public.organizations set super_admin_id = null, super_admin_assigned_at = null;
update public.organizations set super_admin_id = '96000000-0000-4000-8000-000000000007', super_admin_assigned_at = now();
alter table public.organizations enable trigger user;

-- SOPs: a Draft by 2 (in progress), a published SOP by 3 (history only).
insert into public.sops (id, title, department_id, author_id, status, current_version) values
  ('96000000-0000-4000-8000-0000000000a2', 'SD Draft', 'sd-home', '96000000-0000-4000-8000-000000000002', 'draft', 1),
  ('96000000-0000-4000-8000-0000000000a3', 'SD Published', 'sd-home', '96000000-0000-4000-8000-000000000003', 'published', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by) values
  ('96000000-0000-4000-8000-0000000000a2', 1, 'a.pdf', 'pdf', '96000000-0000-4000-8000-000000000002/a2.pdf', 1, '96000000-0000-4000-8000-000000000002'),
  ('96000000-0000-4000-8000-0000000000a3', 1, 'a.pdf', 'pdf', '96000000-0000-4000-8000-000000000003/a3.pdf', 1, '96000000-0000-4000-8000-000000000003');

-- Sign-in sessions of 4 (two devices), each with a refresh token.
insert into auth.sessions (id, user_id) values
  ('96000000-0000-4000-8000-0000000000c1', '96000000-0000-4000-8000-000000000004'),
  ('96000000-0000-4000-8000-0000000000c2', '96000000-0000-4000-8000-000000000004'),
  ('96000000-0000-4000-8000-0000000000c5', '96000000-0000-4000-8000-000000000005');
insert into auth.refresh_tokens (token, user_id, session_id, revoked) values
  ('sd-token-1', '96000000-0000-4000-8000-000000000004', '96000000-0000-4000-8000-0000000000c1', false),
  ('sd-token-2', '96000000-0000-4000-8000-000000000004', '96000000-0000-4000-8000-0000000000c2', false),
  ('sd-token-5', '96000000-0000-4000-8000-000000000005', '96000000-0000-4000-8000-0000000000c5', false);

do $$
declare
  admin constant uuid := '96000000-0000-4000-8000-000000000001';
  busy constant uuid := '96000000-0000-4000-8000-000000000002';
  done constant uuid := '96000000-0000-4000-8000-000000000003';
  free constant uuid := '96000000-0000-4000-8000-000000000004';
  peer constant uuid := '96000000-0000-4000-8000-000000000005';
  admin2 constant uuid := '96000000-0000-4000-8000-000000000006';
  super constant uuid := '96000000-0000-4000-8000-000000000007';
  v_result jsonb;
  v_ended timestamptz;
  v_count integer;
  v_profile public.profiles;
begin
  -- ---------- Grants ----------
  assert has_function_privilege('authenticated', 'public.deactivate_staff(uuid)', 'execute'), 'Signed-in users may call it (the function checks who)';
  assert not has_function_privilege('anon', 'public.deactivate_staff(uuid)', 'execute'), 'Not without signing in';
  assert not has_function_privilege('service_role', 'public.deactivate_staff(uuid)', 'execute'), 'Only an Admin, never a server key';
  assert not has_table_privilege('authenticated', 'public.profiles', 'update'), 'No one changes deleted_at directly';
  assert not has_column_privilege('authenticated', 'public.profiles', 'deleted_at', 'update'), 'No one changes deleted_at directly';
  assert not has_table_privilege('anon', 'public.profiles', 'update');

  -- ---------- 1. Who may deactivate ----------
  -- Not signed in: no access to the function at all.
  perform pg_temp.act_as(null, 'anon');
  perform pg_temp.expect_error(format('select public.deactivate_staff(%L)', free), '42501');
  -- A staff member can't deactivate anyone, not even through a hand-crafted request.
  perform pg_temp.act_as(peer);
  perform pg_temp.expect_error(format('select public.deactivate_staff(%L)', free), '42501');
  perform pg_temp.expect_error(format('update public.profiles set deleted_at = now() where id = %L', free), '42501');
  perform pg_temp.as_owner();
  assert (select deleted_at from public.profiles where id = free) is null, 'Refused requests change nothing';

  -- ---------- 2. What can't be deactivated ----------
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(format('select public.deactivate_staff(%L)', admin), '23514', 'self-delete');
  perform pg_temp.expect_error(format('select public.deactivate_staff(%L)', admin2), '23514', 'admin-managed-separately');
  perform pg_temp.expect_error(format('select public.deactivate_staff(%L)', super), '23514', 'admin-managed-separately');
  perform pg_temp.expect_error(format('select public.deactivate_staff(%L)', gen_random_uuid()), 'P0002');
  -- SOP work in progress blocks it (the same count as the department transfer rule).
  perform pg_temp.expect_error(format('select public.deactivate_staff(%L)', busy), '23514', 'responsibilities-in-progress');
  perform pg_temp.as_owner();
  assert (select count(*) from public.profiles where id in (admin, admin2, super, busy) and deleted_at is null) = 4, 'Refused requests change nothing';
  assert not exists (select 1 from public.organization_management_audit where action = 'deactivate-staff'
    and entity_id in (admin::text, admin2::text, super::text, busy::text, free::text)), 'Refusals write no audit row';

  -- ---------- 3. Deactivating ----------
  perform pg_temp.act_as(admin);
  v_result := public.deactivate_staff(free);
  assert v_result->>'id' = free::text and (v_result->>'alreadyDeactivated')::boolean = false, 'Deactivated';
  -- Published work only: deactivating is allowed, and the published SOP stays as it is.
  perform public.deactivate_staff(done);
  perform pg_temp.as_owner();
  select * into v_profile from public.profiles where id = free;
  v_ended := v_profile.deleted_at;
  assert v_ended is not null, 'The profile is deactivated in the database';
  -- Nothing removed: the profile, its details, permissions and the sign-in account stay.
  assert v_profile.full_name = 'SD Person 4' and v_profile.email = 'sd-4@test.invalid' and v_profile.phone = '+966512345604'
    and v_profile.department_id = 'sd-home' and v_profile."position" = 'Officer', 'Name, contact details, department and position are kept';
  assert pg_temp.roles(free) = array['author', 'reviewer'], 'Historical permissions are kept';
  assert exists (select 1 from auth.users where id = free and deleted_at is null), 'The sign-in account is kept';
  -- Signed out everywhere: no session or refresh token is left; other people keep theirs.
  assert not exists (select 1 from auth.sessions where user_id = free), 'Their sessions are ended';
  assert not exists (select 1 from auth.refresh_tokens where user_id = free::text), 'Their refresh tokens are gone';
  assert exists (select 1 from auth.sessions where user_id = peer) and exists (select 1 from auth.refresh_tokens where user_id = peer::text), 'Others stay signed in';
  -- History stays.
  assert exists (select 1 from public.sops where id = '96000000-0000-4000-8000-0000000000a3' and author_id = done and status = 'published' and deleted_at is null), 'Their published SOP is unchanged';
  assert exists (select 1 from public.sop_versions where sop_id = '96000000-0000-4000-8000-0000000000a3' and uploaded_by = done), 'Their files stay';
  -- Audited, naming the admin.
  assert exists (select 1 from public.organization_management_audit where action = 'deactivate-staff' and entity_id = free::text and actor_id = admin
    and details->>'email' = 'sd-4@test.invalid' and (details->>'endedSessions')::integer = 2), 'Deactivation is audited';

  -- Repeated: nothing changes, no second audit row.
  perform pg_temp.act_as(admin);
  v_result := public.deactivate_staff(free);
  assert (v_result->>'alreadyDeactivated')::boolean, 'A repeated request is harmless';
  perform pg_temp.as_owner();
  assert (select deleted_at from public.profiles where id = free) = v_ended, 'The first deactivation time stays';
  assert (select count(*) from public.organization_management_audit where action = 'deactivate-staff' and entity_id = free::text) = 1;

  -- Admins still see them (their name stays on history), as deactivated.
  perform pg_temp.act_as(admin);
  assert exists (select 1 from public.profiles where id = free and deleted_at is not null), 'An Admin still reads the deactivated profile';
  assert exists (select 1 from public.sops where id = '96000000-0000-4000-8000-0000000000a3'), 'An Admin still reads the published SOP';

  -- ---------- 4. A deactivated person reaches nothing, even with a token issued before ----------
  perform pg_temp.act_as(done);
  assert not public.is_active_user(), 'Not an active user';
  assert not public.has_role('author'), 'Their permissions no longer count';
  assert not exists (select 1 from public.profiles), 'They read no profile, not even their own';
  assert not exists (select 1 from public.sops), 'They read no SOP, not even their own';
  assert not exists (select 1 from public.sop_versions), 'They read no SOP version';
  assert not exists (select 1 from public.departments), 'They read no department';
  perform pg_temp.expect_error(
    $q$select public.create_sop('SD New', '', 'sd-home', '96000000-0000-4000-8000-000000000003/new.pdf', 'new.pdf')$q$, '42501');
  perform pg_temp.expect_error(format('select public.deactivate_staff(%L)', peer), '42501');
  -- A deactivated Admin's token can't manage the organization either (the same helpers).
  perform pg_temp.as_owner();
  update public.profiles set deleted_at = now() where id = admin2;
  perform pg_temp.act_as(admin2);
  assert not public.can_manage_organization(), 'A deactivated Admin manages nothing';
  perform pg_temp.expect_error(format('select public.deactivate_staff(%L)', peer), '42501');

  -- ---------- 5. Edit Staff edits a deactivated staff member but never reactivates them ----------
  -- (20261113130000_staff_reactivation.sql: Edit Staff finds deactivated staff; only Reactivate and Add Staff reactivate.)
  perform pg_temp.act_as(admin);
  perform public.save_user(free, 'SD Person 4', '+966512345604', 'Officer', 'sd-home', array['author']::text[], 'sd-home', array['author','reviewer']::text[]);
  perform public.update_user_details(free, 'SD Person 4', '+966512345604', 'Officer');
  -- The sign-in account still has the old email, so applying a new one is refused (as for anyone).
  perform pg_temp.expect_error(format('select public.set_user_email(%L, ''sd-4-new@test.invalid'', true)', free), '23514', 'invalid');
  perform pg_temp.expect_error(format('update public.profiles set deleted_at = null where id = %L', free), '42501');
  perform pg_temp.as_owner();
  assert (select deleted_at from public.profiles where id = free) = v_ended, 'Still deactivated';

  -- ---------- 6. Add Staff with a deactivated staff member's email: reactivation ----------
  -- A session started while deactivated (they could still sign in to the Auth server).
  insert into auth.sessions (id, user_id) values ('96000000-0000-4000-8000-0000000000c3', free);
  insert into auth.refresh_tokens (token, user_id, session_id, revoked) values ('sd-token-3', free, '96000000-0000-4000-8000-0000000000c3', false);
  -- Staff can't reactivate anyone (nor themselves).
  perform pg_temp.act_as(peer);
  perform pg_temp.expect_error(format('select public.add_user(%L, ''sd-4@test.invalid'', ''Free Again'', ''+966512345699'', ''Lead'', ''sd-other'', array[''reviewer''])', free), '42501');
  perform pg_temp.act_as(free);
  perform pg_temp.expect_error(format('select public.add_user(%L, ''sd-4@test.invalid'', ''Free Again'', ''+966512345699'', ''Lead'', ''sd-other'', array[''reviewer''])', free), '42501');
  -- The Admin, with the new details: the same id, the new details and permissions, active again.
  perform pg_temp.act_as(admin);
  v_result := public.add_user(free, 'sd-4@test.invalid', 'Free Again', '+966512345699', 'Lead', 'sd-other', array['reviewer']);
  assert v_result->>'id' = free::text and (v_result->>'reactivated')::boolean, 'Reactivated, with the same id';
  assert v_result->>'name' = 'Free Again' and v_result->>'phone' = '+966512345699' and v_result->>'position' = 'Lead'
    and v_result->>'departmentId' = 'sd-other' and v_result->'permissions' = '["reviewer"]'::jsonb, 'The submitted details are saved';
  perform pg_temp.as_owner();
  select * into v_profile from public.profiles where id = free;
  assert v_profile.deleted_at is null and v_profile.full_name = 'Free Again' and v_profile.department_id = 'sd-other', 'Active again, with the new details';
  assert pg_temp.roles(free) = array['reviewer'], 'Only the submitted permissions';
  assert (select count(*) from public.profiles where email = 'sd-4@test.invalid') = 1, 'No second profile';
  assert (select count(*) from auth.users where lower(email) = 'sd-4@test.invalid') = 1, 'No second sign-in account';
  assert not exists (select 1 from auth.sessions where user_id = free) and not exists (select 1 from auth.refresh_tokens where user_id = free::text),
    'No old session comes back with the profile';
  assert exists (select 1 from public.organization_management_audit where action = 'reactivate-user' and entity_id = free::text and actor_id = admin
    and (details->>'deactivatedAt')::timestamptz = v_ended and details->>'email' = 'sd-4@test.invalid'), 'Reactivation is audited';
  assert exists (select 1 from public.organization_management_audit where action = 'add-user' and entity_id = free::text and details = '{"readded": true}'::jsonb),
    'The usual Add Staff audit row too';
  -- Now active: Add Staff with the same email is a duplicate again.
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(format('select public.add_user(%L, ''sd-4@test.invalid'', ''Free Again'', ''+966512345699'', ''Lead'', ''sd-other'', array[''reviewer''])', free), '23514', 'email-taken');
  -- An active staff member's email is always refused.
  perform pg_temp.expect_error(format('select public.add_user(%L, ''sd-5@test.invalid'', ''Peer'', ''+966512345605'', ''Officer'', ''sd-home'', array[''author''])', peer), '23514', 'email-taken');

  -- ---------- 7. Add Staff never brings back an Admin ----------
  perform pg_temp.expect_error(format('select public.add_user(%L, ''sd-6@test.invalid'', ''Admin Six'', ''+966512345606'', ''Officer'', ''sd-home'', array[''author''])', admin2),
    '23514', 'admin-managed-separately');
  perform pg_temp.as_owner();
  assert (select deleted_at from public.profiles where id = admin2) is not null, 'The former Admin stays deactivated';
  assert pg_temp.roles(admin2) = array['admin'], 'Their role is unchanged';
  -- The Super Admin can't be deactivated, so it never needs bringing back; its row stays.
  assert (select o.super_admin_id from public.organizations o) = super;

  -- ---------- 8. The whole cycle again: deactivate the reactivated person ----------
  perform pg_temp.act_as(admin);
  assert not (public.deactivate_staff(free)->>'alreadyDeactivated')::boolean, 'A reactivated person can be deactivated again';
  perform pg_temp.as_owner();
  assert (select count(*) from public.organization_management_audit where action = 'deactivate-staff' and entity_id = free::text) = 2;

  raise notice 'staff_deactivation.sql: all checks passed';
end;
$$;

rollback;
