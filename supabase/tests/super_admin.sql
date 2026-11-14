-- Tests for 20261111120000_super_admin.sql: the Super Admin designation, Add/Edit/Delete Admin,
-- Make Super Admin, the Request Hawkim onboarding and the Staff paths that must not get around them.
-- Every call is made as the API would make it (role authenticated or service_role, with the caller's
-- id in the JWT claims), so these are the direct, hand-crafted requests the browser can't stop.
-- Only for a disposable LOCAL database with every migration applied; never the shared project.
-- Everything is rolled back.
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

-- A clean start: no Super Admin and no active Admin (as a new deployment). Rolled back.
alter table public.super_admin disable trigger user;
delete from public.super_admin;
alter table public.super_admin enable trigger user;
update public.profiles p set deleted_at = now()
where p.deleted_at is null and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin');

-- People: 1 applicant (future Super Admin), 2-3 Admins added later, 4 staff, 5 banned Admin,
-- 6 a second organization's applicant, 7 a new Admin added by a regular Admin.
insert into auth.users (id, email, aud, role)
select ('95000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'sa-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 7) n;
insert into public.departments (id, name, initials) values ('sa-home', 'SA Home', 'SH') on conflict do nothing;

insert into public.access_requests (id, organization, contact_name, job_title, email, phone, approx_users, review_token_hash, review_expires_at)
values
  ('95000000-0000-4000-8000-0000000000a1', 'Org One', 'Applicant One', 'Director', 'sa-1@test.invalid', '+966512345601', 10, repeat('a', 64), now() + interval '1 day'),
  ('95000000-0000-4000-8000-0000000000a2', 'Org Two', 'Applicant Two', 'Director', 'sa-6@test.invalid', '+966512345606', 10, repeat('b', 64), now() + interval '1 day');

do $$
declare
  sa constant uuid := '95000000-0000-4000-8000-000000000001';
  a1 constant uuid := '95000000-0000-4000-8000-000000000002';
  a2 constant uuid := '95000000-0000-4000-8000-000000000003';
  st constant uuid := '95000000-0000-4000-8000-000000000004';
  banned constant uuid := '95000000-0000-4000-8000-000000000005';
  other_org constant uuid := '95000000-0000-4000-8000-000000000006';
  a3 constant uuid := '95000000-0000-4000-8000-000000000007';
  v_saved jsonb;
  v_audit public.organization_management_audit;
begin
  -- ---------- Grants ----------
  assert not has_table_privilege('authenticated', 'public.super_admin', 'select'), 'super_admin is not readable directly';
  assert not has_table_privilege('authenticated', 'public.super_admin', 'update'), 'super_admin is not writable directly';
  assert not has_table_privilege('service_role', 'public.super_admin', 'update');
  assert not has_function_privilege('anon', 'public.transfer_super_admin(uuid)', 'execute');
  assert not has_function_privilege('anon', 'public.delete_admin(uuid)', 'execute');
  assert has_function_privilege('authenticated', 'public.transfer_super_admin(uuid)', 'execute');
  assert has_function_privilege('authenticated', 'public.update_admin(uuid,text,text)', 'execute');
  assert not has_function_privilege('authenticated', 'public.assign_initial_super_admin(uuid)', 'execute'), 'Only the owner assigns the first Super Admin by hand';
  assert not has_function_privilege('service_role', 'public.assign_initial_super_admin(uuid)', 'execute');
  assert not has_function_privilege('authenticated', 'public.super_admin_id()', 'execute');
  assert not has_function_privilege('authenticated', 'public.accept_access_request(uuid,text,uuid,text)', 'execute');
  assert has_function_privilege('service_role', 'public.accept_access_request(uuid,text,uuid,text)', 'execute');
  assert has_function_privilege('service_role', 'public.deployment_onboarded()', 'execute');

  -- ---------- 1. Request Hawkim: the approved applicant is the initial Super Admin ----------
  perform pg_temp.act_as(null, 'service_role');
  assert public.deployment_onboarded() = false, 'A new deployment has not been onboarded';
  perform public.accept_access_request('95000000-0000-4000-8000-0000000000a1', repeat('a', 64), sa, 'sa-home');
  perform pg_temp.as_owner();
  assert public.super_admin_id() = sa, 'The applicant of the accepted request is the Super Admin';
  assert (select count(*) from public.super_admin) = 1;
  assert exists (select 1 from public.user_roles where user_id = sa and role = 'admin'), 'The Super Admin holds the Admin role';
  -- One organization per deployment: another request is refused, before and inside the function.
  perform pg_temp.act_as(null, 'service_role');
  assert public.deployment_onboarded() = true;
  perform pg_temp.expect_error(format('select public.accept_access_request(%L, %L, %L, %L)',
    '95000000-0000-4000-8000-0000000000a2', repeat('b', 64), other_org, 'sa-home'), 'P0001');
  perform pg_temp.as_owner();
  assert public.super_admin_id() = sa, 'A refused request changes nothing';
  assert (select status from public.access_requests where id = '95000000-0000-4000-8000-0000000000a2') = 'pending';
  assert not exists (select 1 from public.profiles where id = other_org);
  perform pg_temp.expect_error(format('select public.assign_initial_super_admin(%L)', a1), '23514');

  -- ---------- 2. The designation itself ----------
  perform pg_temp.expect_error('delete from public.super_admin', '23514', 'super-admin-required');
  perform pg_temp.expect_error('truncate public.super_admin', '23514', 'super-admin-required');
  -- A second row is impossible (the key can only be true), whoever it names.
  perform pg_temp.expect_error(format('insert into public.super_admin (user_id) values (%L)', sa), '23505');
  perform pg_temp.expect_error(format('insert into public.super_admin (singleton, user_id) values (false, %L)', sa), '23514');
  -- Only an active Admin can hold it.
  perform pg_temp.expect_error(format('update public.super_admin set user_id = %L', other_org), '23514', 'recipient-not-admin');
  -- The Super Admin can't be ended or lose the Admin role while holding it, by anyone.
  perform pg_temp.expect_error(format('update public.profiles set deleted_at = now() where id = %L', sa), '23514', 'super-admin-protected');
  perform pg_temp.expect_error(format('delete from public.user_roles where user_id = %L and role = ''admin''', sa), '23514', 'super-admin-protected');

  -- ---------- 3. Add Admin (add_user with the Admin permission, as add-user calls it) ----------
  perform pg_temp.act_as(sa);
  v_saved := public.add_user(a1, 'sa-2@test.invalid', 'Admin Two', '+966512345602', null, null, array['admin']);
  assert v_saved->'permissions' = '["admin"]'::jsonb, 'Super Admin adds a regular Admin';
  perform public.add_user(st, 'sa-4@test.invalid', 'Staff Four', '+966512345604', 'Officer', 'sa-home', array['author']);
  perform pg_temp.act_as(a1);
  perform public.add_user(a2, 'sa-3@test.invalid', 'Admin Three', '+966512345603', null, null, array['admin']);
  perform public.add_user(banned, 'sa-5@test.invalid', 'Admin Five', '+966512345605', null, null, array['admin']);
  assert public.get_super_admin_id() = sa, 'Adding Admins never moves the Super Admin';
  perform pg_temp.as_owner();
  assert (select count(*) from public.super_admin) = 1;
  perform pg_temp.act_as(a1);
  -- A duplicate is refused (retrying uses the same account; it never makes a second profile).
  perform pg_temp.expect_error(format('select public.add_user(%L, %L, %L, %L, null, null, array[''admin''])',
    a2, 'sa-3@test.invalid', 'Admin Three', '+966512345603'), '23514', 'email-taken');
  -- Invalid details.
  perform pg_temp.expect_error(format('select public.add_user(%L, %L, %L, %L, null, null, array[''admin''])',
    a3, 'sa-7@test.invalid', 'Admin Seven', '0512345607'), '23514', 'invalid');
  -- Staff can't add anyone.
  perform pg_temp.act_as(st);
  perform pg_temp.expect_error(format('select public.add_user(%L, %L, %L, %L, null, null, array[''admin''])',
    a3, 'sa-7@test.invalid', 'Admin Seven', '+966512345607'), '42501');
  perform pg_temp.as_owner();
  update auth.users set banned_until = now() + interval '1 day' where id = banned;

  -- ---------- 4. Staff can't make or unmake Admins ----------
  perform pg_temp.act_as(sa);
  perform pg_temp.expect_error(format('select public.save_user(%L, %L, %L, %L, %L, array[''admin''], %L, array[''author''])',
    st, 'Staff Four', '+966512345604', 'Officer', 'sa-home', 'sa-home'), '23514', 'admin-managed-separately');
  perform pg_temp.expect_error(format('select public.save_user(%L, %L, %L, %L, %L, array[''author''], null, array[''admin''])',
    a1, 'Admin Two', '+966512345602', 'Officer', 'sa-home'), '23514', 'admin-managed-separately');
  perform pg_temp.expect_error(format('insert into public.user_roles (user_id, role) values (%L, ''admin'')', st), '42501');
  perform pg_temp.expect_error(format('update public.profiles set full_name = ''X'' where id = %L', a1), '42501');

  -- ---------- 5. Edit Admin ----------
  perform pg_temp.act_as(a1);
  v_saved := public.update_admin(a2, 'Admin Three Renamed', '+966512345613');
  assert v_saved->>'initials' = 'AR' and v_saved->>'phone' = '+966512345613', 'A regular Admin edits a regular Admin';
  perform public.update_admin(a1, 'Admin Two', '+966512345612');
  perform pg_temp.expect_error(format('select public.update_admin(%L, %L, %L)', sa, 'Hijacked', '+966512345699'), '42501', 'super-admin-protected');
  -- …nor through the Staff save or the email change (refused already in update-user-email's dry run).
  -- (The Super Admin has no department since 20261112140000: the expected one is null.)
  perform pg_temp.expect_error(format('select public.save_user(%L, %L, %L, null, null, array[''admin''], null, array[''admin''])',
    sa, 'Hijacked', '+966512345699'), '42501', 'super-admin-protected');
  perform pg_temp.expect_error(format('select public.set_user_email(%L, %L, false)', sa, 'evil@test.invalid'), '42501', 'super-admin-protected');
  perform pg_temp.expect_error(format('select public.update_admin(%L, %L, %L)', st, 'Staff', '+966512345604'), 'P0002');
  perform pg_temp.expect_error(format('select public.update_admin(%L, %L, %L)', a2, '  ', '+966512345604'), '23514', 'invalid');
  perform pg_temp.expect_error(format('select public.update_admin(%L, %L, %L)', a2, 'Name', '0512345604'), '23514', 'invalid');
  perform pg_temp.act_as(sa);
  perform public.update_admin(sa, 'Applicant One', '+966512345611');
  assert public.set_user_email(sa, 'sa-1@test.invalid', false) is null, 'The Super Admin may change their own email';
  perform public.update_admin(a1, 'Admin Two', '+966512345602');
  perform pg_temp.act_as(st);
  perform pg_temp.expect_error(format('select public.update_admin(%L, %L, %L)', a1, 'X', '+966512345602'), '42501');
  perform pg_temp.as_owner();
  assert (select full_name from public.profiles where id = sa) = 'Applicant One', 'Refused edits changed nothing';
  assert public.super_admin_id() = sa and (select array_agg(role::text) from public.user_roles where user_id = a2) = array['admin'],
    'Editing never changes a role';

  -- ---------- 6. Delete Admin ----------
  perform pg_temp.act_as(a1);
  perform pg_temp.expect_error(format('select public.delete_admin(%L)', a2), '42501', 'super-admin-required');
  perform pg_temp.expect_error(format('select public.delete_admin(%L)', a1), '42501', 'super-admin-required');
  perform pg_temp.expect_error(format('select public.delete_admin(%L)', sa), '42501', 'super-admin-required');
  perform pg_temp.act_as(sa);
  perform pg_temp.expect_error(format('select public.delete_admin(%L)', sa), '23514', 'super-admin-protected');
  perform pg_temp.expect_error(format('select public.delete_admin(%L)', st), 'P0002');
  perform public.delete_admin(a2);
  perform pg_temp.as_owner();
  assert (select deleted_at is not null from public.profiles where id = a2), 'The Super Admin deletes a regular Admin';
  assert exists (select 1 from public.profiles where id = a2), 'Deleting keeps the profile for history';
  select * into v_audit from public.organization_management_audit where action = 'delete-admin' and entity_id = a2::text;
  assert v_audit.actor_id = sa, 'Deleting is audited';
  perform pg_temp.act_as(a2);
  assert not public.can_manage_organization(), 'A deleted Admin loses access immediately';
  perform pg_temp.act_as(sa);
  perform pg_temp.expect_error(format('select public.delete_admin(%L)', a2), 'P0002');

  -- ---------- 7. Make Super Admin ----------
  perform pg_temp.act_as(a1);
  perform pg_temp.expect_error(format('select public.transfer_super_admin(%L)', a1), '42501', 'super-admin-required');
  perform pg_temp.act_as(st);
  perform pg_temp.expect_error(format('select public.transfer_super_admin(%L)', st), '42501', 'super-admin-required');
  perform pg_temp.act_as(sa);
  perform pg_temp.expect_error(format('select public.transfer_super_admin(%L)', sa), '23514', 'recipient-self');
  perform pg_temp.expect_error('select public.transfer_super_admin(null)', '23514', 'recipient-self');
  perform pg_temp.expect_error(format('select public.transfer_super_admin(%L)', st), '23514', 'recipient-not-admin');
  perform pg_temp.expect_error(format('select public.transfer_super_admin(%L)', a2), '23514', 'recipient-not-admin');
  perform pg_temp.expect_error(format('select public.transfer_super_admin(%L)', banned), '23514', 'recipient-not-admin');
  perform pg_temp.expect_error(format('select public.transfer_super_admin(%L)', other_org), '23514', 'recipient-not-admin');
  perform pg_temp.as_owner();
  assert public.super_admin_id() = sa, 'Refused transfers change nothing';

  perform pg_temp.act_as(sa);
  assert public.transfer_super_admin(a1) = a1;
  perform pg_temp.as_owner();
  assert public.super_admin_id() = a1 and (select count(*) from public.super_admin) = 1, 'Exactly one Super Admin after the transfer';
  assert exists (select 1 from public.user_roles where user_id = sa and role = 'admin'), 'The former Super Admin stays an Admin';
  select * into v_audit from public.organization_management_audit where action = 'transfer-super-admin' order by id desc limit 1;
  assert v_audit.actor_id = sa and v_audit.entity_id = a1::text
    and v_audit.details->>'previousSuperAdminId' = sa::text and v_audit.details->>'newSuperAdminId' = a1::text
    and v_audit.details->'before'->>(sa::text) = 'super-admin' and v_audit.details->'after'->>(sa::text) = 'admin'
    and v_audit.created_at is not null, 'The transfer is audited with before and after';

  -- The former Super Admin's open session loses the elevated actions at once…
  perform pg_temp.act_as(sa);
  assert not public.is_super_admin() and public.get_super_admin_id() = a1;
  perform pg_temp.expect_error(format('select public.transfer_super_admin(%L)', a1), '42501', 'super-admin-required');
  perform pg_temp.expect_error(format('select public.delete_admin(%L)', a1), '42501', 'super-admin-required');
  perform pg_temp.expect_error(format('select public.update_admin(%L, %L, %L)', a1, 'X', '+966512345602'), '42501', 'super-admin-protected');
  -- …and keeps every regular Admin permission.
  assert public.can_manage_organization(), 'The former Super Admin is still an Admin';
  perform public.update_admin(sa, 'Applicant One', '+966512345601');
  perform public.add_user(a3, 'sa-7@test.invalid', 'Admin Seven', '+966512345607', null, null, array['admin']);
  perform public.save_division(null, 'SA Division ' || gen_random_uuid(), '', null);

  -- The new Super Admin has them, and may now delete the former one.
  perform pg_temp.act_as(a1);
  assert public.is_super_admin();
  perform pg_temp.expect_error(format('select public.delete_admin(%L)', a1), '23514', 'super-admin-protected');
  perform public.delete_admin(sa);
  perform pg_temp.as_owner();
  assert (select deleted_at is not null from public.profiles where id = sa), 'Former Super Admin deleted after the transfer';
  assert public.super_admin_id() = a1 and (select count(*) from public.super_admin) = 1;

  -- A refused transfer leaves both roles as they were (all or nothing).
  perform pg_temp.act_as(a1);
  perform pg_temp.expect_error(format('select public.transfer_super_admin(%L)', sa), '23514', 'recipient-not-admin');
  perform pg_temp.as_owner();
  assert public.super_admin_id() = a1;

  -- ---------- 8. Everything else stays open to both levels ----------
  perform pg_temp.act_as(a3);
  assert public.can_manage_organization() and not public.is_super_admin(), 'A regular Admin manages the organization';
  perform public.save_division(null, 'SA Division ' || gen_random_uuid(), '', null);
  perform public.update_user_details(st, 'Staff Four', '+966512345604', 'Senior Officer');
  perform public.save_user(st, 'Staff Four', '+966512345604', 'Senior Officer', 'sa-home', array['author', 'reviewer'], 'sa-home', array['author']);
  assert (select array_agg(role::text order by role::text) from public.user_roles where user_id = st) = array['author', 'reviewer'],
    'A regular Admin changes staff permissions';

  perform pg_temp.as_owner();
  raise notice 'super_admin.sql: all checks passed';
end;
$$;

rollback;
