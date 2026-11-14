-- Tests for 20261116160000_scope_staff_functions.sql: an Admin of one organization can't see, change,
-- deactivate, reactivate, re-add, invite or count the people of another organization through the staff,
-- Admin and invitation functions. Each refusal is the one for an id that doesn't exist.
-- Only for a disposable LOCAL database with every migration and the seed applied. Everything is rolled back.
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

-- MedCare (the seed's organization): an Admin, a staff member, a deactivated staff member, an invitation.
-- Other: its Admin and a staff member.
insert into auth.users (id, email, aud, role)
select ('98200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'scope-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 8) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position") values
  ('98200000-0000-4000-8000-000000000001', 'Scope Med Admin', 'scope-1@test.invalid', 'SA', null, '+966512345601', null),
  ('98200000-0000-4000-8000-000000000002', 'Scope Med Staff', 'scope-2@test.invalid', 'SS', 'pharmacovigilance', '+966512345602', 'Officer'),
  ('98200000-0000-4000-8000-000000000003', 'Scope Med Former', 'scope-3@test.invalid', 'SF', 'pharmacovigilance', '+966512345603', 'Officer');
insert into public.user_roles (user_id, role) values
  ('98200000-0000-4000-8000-000000000001', 'admin'), ('98200000-0000-4000-8000-000000000002', 'author'),
  ('98200000-0000-4000-8000-000000000003', 'author');
update public.profiles set deleted_at = now() where id = '98200000-0000-4000-8000-000000000003';
insert into public.user_invitations (user_id, sent_at, sent_by)
values ('98200000-0000-4000-8000-000000000002', now() - interval '3 days', '98200000-0000-4000-8000-000000000001');

insert into public.organizations (id, name) values ('98200000-0000-4000-8000-0000000000aa', 'Scope Other');
insert into public.departments (id, name, initials, organization_id)
values ('scope-other-department', 'Scope Other Department', 'SOD', '98200000-0000-4000-8000-0000000000aa');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id) values
  ('98200000-0000-4000-8000-000000000004', 'Scope Other Admin', 'scope-4@test.invalid', 'OA', null, '+966512345604', null,
   '98200000-0000-4000-8000-0000000000aa'),
  ('98200000-0000-4000-8000-000000000005', 'Scope Other Staff', 'scope-5@test.invalid', 'OS', 'scope-other-department', '+966512345605', 'Officer',
   '98200000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values
  ('98200000-0000-4000-8000-000000000004', 'admin'), ('98200000-0000-4000-8000-000000000005', 'author');
insert into public.user_invitations (user_id, sent_at, sent_by)
values ('98200000-0000-4000-8000-000000000005', now() - interval '3 days', '98200000-0000-4000-8000-000000000004');
set constraints all immediate;   -- the fixtures are valid now ...
set constraints all deferred;    -- ... and the calls below are checked at commit, as in a real request

do $$
declare
  med_admin constant uuid := '98200000-0000-4000-8000-000000000001';
  med_staff constant uuid := '98200000-0000-4000-8000-000000000002';
  med_former constant uuid := '98200000-0000-4000-8000-000000000003';
  other_admin constant uuid := '98200000-0000-4000-8000-000000000004';
  other_staff constant uuid := '98200000-0000-4000-8000-000000000005';
  fresh_account constant uuid := '98200000-0000-4000-8000-000000000006';
  v_count integer;
begin
  perform pg_temp.act_as(other_admin);

  -- ---------- Edit Staff, its parts and positions: MedCare's people are "not found" ----------
  perform pg_temp.expect_error(format('select public.save_user(%L, %L, %L, %L, %L, %L, %L, %L)', med_staff, 'Taken Over',
    '+966512345699', 'Officer', 'pharmacovigilance', array['author'], 'pharmacovigilance', array['author']), 'P0002');
  perform pg_temp.expect_error(format('select public.update_user_details(%L, %L, %L, %L)', med_staff, 'Taken Over', '+966512345699', 'Officer'), 'P0002');
  perform pg_temp.expect_error(format('select public.set_user_email(%L, %L, false)', med_staff, 'scope-new@test.invalid'), 'P0002');
  -- (set_employee_positions answers an unknown person with its conflict, as it always has.)
  perform pg_temp.expect_error(format('select public.set_employee_positions(%L, %L)', med_staff, array['Taken']), 'P0001', 'conflict');
  perform pg_temp.expect_error(format('select public.update_admin(%L, %L, %L)', med_admin, 'Taken Over', '+966512345699'), 'P0002');
  -- Moving their own staff into MedCare's department: that department is unknown to them.
  perform pg_temp.expect_error(format('select public.save_user(%L, %L, %L, %L, %L, %L, %L, %L)', other_staff, 'Scope Other Staff',
    '+966512345605', 'Officer', 'pharmacovigilance', array['author'], 'scope-other-department', array['author']), '23514', 'department-unavailable');

  -- ---------- Delete Staff and Reactivate ----------
  perform pg_temp.expect_error(format('select public.deactivate_staff(%L)', med_staff), 'P0002');
  perform pg_temp.expect_error(format('select public.reactivate_staff(%L)', med_former), 'P0002');

  -- ---------- Add Staff ----------
  -- MedCare's (deactivated) person can't be re-added into Other: one account, one organization.
  perform pg_temp.expect_error(format('select public.add_user(%L, %L, %L, %L, %L, %L, %L)', med_former, 'scope-3@test.invalid',
    'Scope Med Former', '+966512345603', 'Officer', 'scope-other-department', array['author']), '23514', 'email-taken');
  -- Nor a new person into MedCare's department.
  perform pg_temp.expect_error(format('select public.check_new_user(%L, %L, %L, %L, %L, %L)', 'scope-6@test.invalid',
    'Scope New', '+966512345606', 'Officer', 'pharmacovigilance', array['author']), '23514', 'department-unavailable');
  -- A new person is added to the caller's organization.
  perform public.add_user(fresh_account, 'scope-6@test.invalid', 'Scope New', '+966512345606', 'Officer', 'scope-other-department', array['author']);
  perform pg_temp.as_owner();
  assert (select organization_id from public.profiles where id = fresh_account) = '98200000-0000-4000-8000-0000000000aa',
    'The added person is in the Admin''s organization';
  perform pg_temp.act_as(other_admin);

  -- ---------- Invitations ----------
  perform pg_temp.expect_error(format('select public.record_invitation_sent(%L)', med_staff), 'P0002', 'not-found');
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', med_staff), 'P0002', 'not-found');
  assert public.revert_invitation_resend(med_staff, now()) = false, 'MedCare''s invitation is not reverted';
  select count(*) into v_count from public.get_my_expired_invitations() i where i.user_id = med_staff;
  assert v_count = 0, 'MedCare''s expired invitation is not in Other''s bell';
  select count(*) into v_count from public.get_my_expired_invitations() i where i.user_id = other_staff;
  assert v_count = 1, 'Other''s own expired invitation is';

  -- ---------- Admins: delete, transfer ----------
  perform pg_temp.as_owner();
  update public.organizations set super_admin_id = other_admin where id = '98200000-0000-4000-8000-0000000000aa';
  perform pg_temp.act_as(other_admin);
  perform pg_temp.expect_error(format('select public.delete_admin(%L)', med_admin), 'P0002');
  perform pg_temp.expect_error(format('select public.transfer_super_admin(%L)', med_admin), '23514', 'recipient-not-admin');

  -- ---------- Nothing in MedCare changed ----------
  perform pg_temp.as_owner();
  assert (select full_name = 'Scope Med Staff' and deleted_at is null from public.profiles where id = med_staff), 'MedCare staff untouched';
  assert (select deleted_at is not null from public.profiles where id = med_former), 'still deactivated';
  assert (select deleted_at is null from public.profiles where id = med_admin), 'MedCare Admin untouched';
  assert (select super_admin_id from public.organizations where id = '98200000-0000-4000-8000-0000000000aa') = other_admin,
    'Other''s Super Admin unchanged';
  assert not exists (select 1 from public.employee_positions where profile_id = med_staff and title = 'Taken'), 'no position added';

  -- ---------- And within one's own organization everything still works ----------
  perform pg_temp.act_as(med_admin);
  perform public.update_user_details(med_staff, 'Scope Med Staff Renamed', '+966512345602', 'Officer');
  perform pg_temp.as_owner();
  assert (select full_name from public.profiles where id = med_staff) = 'Scope Med Staff Renamed', 'MedCare''s Admin edits MedCare''s staff';

  -- ---------- The lock helper ----------
  assert to_regprocedure('public.lock_organization_changes(uuid)') is not null;
  assert not has_function_privilege('authenticated', 'public.lock_organization_changes(uuid)', 'execute'), 'internal';
end;
$$;

rollback;
