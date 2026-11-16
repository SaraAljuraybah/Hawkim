-- Tests for 20261123120000_staff_invitations_reinvite.sql: re-inviting a cancelled staff member through Add Staff
-- (check_new_user, add_user, is_invitation_cancelled, record_invitation_sent), a cancelled link staying "cancelled"
-- after the re-invite, get_unactivated_people, and the triggers that refuse not-yet-activated people as new
-- co-authors and reviewers. Legacy people (no invitation record) are unchanged. Calls are made as the API makes them.
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
create function pg_temp.unactivated() returns text[]
language sql as $$
  select coalesce(array_agg(u.user_id::text || ':' || u.cancelled order by u.user_id), '{}') from public.get_unactivated_people() u
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(), pg_temp.unactivated() to public;

-- MedCare: 1 an Admin, 2 staff (to be cancelled, then re-invited), 3 staff (waiting), 4 legacy staff (no record),
-- 5 an author with an SOP. Other: 6 its Admin, 7 its staff member.
insert into auth.users (id, email, aud, role)
select ('9e200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'ri-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 7) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
select ('9e200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'RI Person ' || n, 'ri-' || n || '@test.invalid', 'RP',
       case when n = 1 then null else 'pharmacovigilance' end, '+96651234570' || n, case when n = 1 then null else 'Officer' end
from generate_series(1, 5) n;
insert into public.user_roles (user_id, role)
select ('9e200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, case when n = 1 then 'admin' else 'author' end::public.app_role
from generate_series(1, 5) n;
insert into public.organizations (id, name) values ('9e200000-0000-4000-8000-0000000000aa', 'RI Other');
insert into public.departments (id, name, initials, organization_id)
values ('ri-other-department', 'RI Other Department', 'ROD', '9e200000-0000-4000-8000-0000000000aa');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id) values
  ('9e200000-0000-4000-8000-000000000006', 'RI Other Admin', 'ri-6@test.invalid', 'OA', null, '+966512345706', null, '9e200000-0000-4000-8000-0000000000aa'),
  ('9e200000-0000-4000-8000-000000000007', 'RI Other Staff', 'ri-7@test.invalid', 'OS', 'ri-other-department', '+966512345707', 'Officer', '9e200000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values
  ('9e200000-0000-4000-8000-000000000006', 'admin'), ('9e200000-0000-4000-8000-000000000007', 'author');
insert into public.sops (id, title, department_id, author_id, current_version)
values ('9e200000-0000-4000-8000-0000000000b1', 'RI SOP', 'pharmacovigilance', '9e200000-0000-4000-8000-000000000005', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
select '9e200000-0000-4000-8000-0000000000b1', 1, 'ri.pdf', 'pdf', o.id || '/9e200000-0000-4000-8000-000000000005/ri.pdf', 1, '9e200000-0000-4000-8000-000000000005'
from public.organizations o order by o.created_at, o.id limit 1;
set constraints all immediate;
set constraints all deferred;

do $$
declare
  admin constant uuid := '9e200000-0000-4000-8000-000000000001';
  s2 constant uuid := '9e200000-0000-4000-8000-000000000002';
  s3 constant uuid := '9e200000-0000-4000-8000-000000000003';
  legacy constant uuid := '9e200000-0000-4000-8000-000000000004';
  author constant uuid := '9e200000-0000-4000-8000-000000000005';
  other_admin constant uuid := '9e200000-0000-4000-8000-000000000006';
  other_staff constant uuid := '9e200000-0000-4000-8000-000000000007';
  sop constant uuid := '9e200000-0000-4000-8000-0000000000b1';
  old_ref constant uuid := '9e200000-0000-4000-8000-0000000000f1';
  new_ref constant uuid := '9e200000-0000-4000-8000-0000000000f2';
  v_saved jsonb;
  v_count int;
begin
  -- ---------- Grants ----------
  assert not has_function_privilege('anon', 'public.get_unactivated_people()', 'execute');
  assert not has_function_privilege('anon', 'public.is_invitation_cancelled(uuid)', 'execute');
  assert not has_function_privilege('authenticated', 'public.invitation_unactivated(uuid)', 'execute');
  assert not has_function_privilege('authenticated', 'public.invitation_cancelled(uuid)', 'execute');
  assert not has_function_privilege('authenticated', 'public.guard_activated_assignee()', 'execute');

  -- s2 and s3 are invited; s2's invitation is cancelled.
  perform pg_temp.act_as(admin);
  perform public.record_invitation_sent(s2, old_ref);
  perform public.record_invitation_sent(s3, gen_random_uuid());
  perform public.cancel_invitation(s2);

  -- ---------- Who can't be given new work ----------
  perform pg_temp.act_as(legacy);
  assert pg_temp.unactivated() = array[s2 || ':true', s3 || ':false'], 'any active user sees the not-activated people: ' || pg_temp.unactivated()::text;
  perform pg_temp.act_as(other_staff);
  assert pg_temp.unactivated() = '{}', 'never another organization''s';
  perform pg_temp.act_as(s2);
  assert pg_temp.unactivated() = '{}', 'a cancelled person sees nothing';

  -- Triggers: not-yet-activated people can't be added as co-authors (or reviewers); legacy people can.
  perform pg_temp.as_owner();
  perform pg_temp.expect_error(format('insert into public.sop_co_authors (sop_id, user_id, added_by) values (%L, %L, %L)', sop, s3, author), '23514', 'person-not-activated');
  perform pg_temp.expect_error(format('insert into public.sop_co_authors (sop_id, user_id, added_by) values (%L, %L, %L)', sop, s2, author), '23514', 'person-not-activated');
  insert into public.sop_co_authors (sop_id, user_id, added_by) values (sop, legacy, author);
  assert exists (select 1 from pg_trigger where tgname = 'zz_review_requests_activated_reviewer' and tgrelid = 'public.review_requests'::regclass and tgenabled = 'O');
  assert exists (select 1 from pg_trigger where tgname = 'zz_sop_co_authors_activated_co_author' and tgrelid = 'public.sop_co_authors'::regclass and tgenabled = 'O');

  -- ---------- Add Staff with the cancelled person's email ----------
  perform pg_temp.act_as(admin);
  assert public.is_invitation_cancelled(s2) and not public.is_invitation_cancelled(s3) and not public.is_invitation_cancelled(legacy);
  -- Not "taken" for Add Staff; still taken for Add Admin, and a waiting or legacy email is still taken.
  perform public.check_new_user('ri-2@test.invalid', 'RI Person 2', '+966512345702', 'Senior Officer', 'pharmacovigilance', array['author', 'reviewer']);
  perform pg_temp.expect_error($q$select public.check_new_user('ri-2@test.invalid', 'X', '+966512345702', null, null, array['admin'])$q$, '23514', 'email-taken');
  perform pg_temp.expect_error($q$select public.check_new_user('ri-3@test.invalid', 'X', '+966512345703', 'Officer', 'pharmacovigilance', array['author'])$q$, '23514', 'email-taken');
  perform pg_temp.expect_error($q$select public.check_new_user('ri-4@test.invalid', 'X', '+966512345704', 'Officer', 'pharmacovigilance', array['author'])$q$, '23514', 'email-taken');
  perform pg_temp.expect_error(format($q$select public.add_user(%L, 'ri-3@test.invalid', 'X', '+966512345703', 'Officer', 'pharmacovigilance', array['author'])$q$, s3), '23514', 'email-taken');
  -- Another organization's Admin can't see or re-invite them.
  perform pg_temp.act_as(other_admin);
  assert not public.is_invitation_cancelled(s2), 'not another organization''s';
  perform pg_temp.expect_error($q$select public.check_new_user('ri-2@test.invalid', 'X', '+966512345702', 'Officer', 'ri-other-department', array['author'])$q$, '23514', 'email-taken');
  perform pg_temp.act_as(legacy);
  perform pg_temp.expect_error(format('select public.is_invitation_cancelled(%L)', s2), '42501', 'forbidden');

  -- The re-invite itself: the same profile, the details entered, sessions ended, audited.
  perform pg_temp.as_owner();
  insert into auth.sessions (id, user_id) values (gen_random_uuid(), s2);
  perform pg_temp.act_as(admin);
  v_saved := public.add_user(s2, 'ri-2@test.invalid', 'RI Person 2 Again', '+966512345799', 'Senior Officer', 'pharmacovigilance', array['author', 'reviewer']);
  assert v_saved ->> 'reinvited' = 'true' and v_saved ->> 'reactivated' = 'false', 'reinvited: ' || v_saved::text;
  perform pg_temp.as_owner();
  select count(*) into v_count from public.profiles where email = 'ri-2@test.invalid';
  assert v_count = 1, 'no second profile';
  assert exists (select 1 from public.profiles where id = s2 and full_name = 'RI Person 2 Again' and phone = '+966512345799'
    and "position" = 'Senior Officer' and deleted_at is null), 'the details entered are saved on the same profile';
  assert (select array_agg(role::text order by role) from public.user_roles where user_id = s2) = array['author', 'reviewer'];
  assert not exists (select 1 from auth.sessions where user_id = s2), 'sessions ended';
  assert exists (select 1 from public.organization_management_audit where action = 'reinvite-user' and entity_id = s2::text and actor_id = admin);
  -- Still cancelled (no access) until the new invitation is recorded as sent.
  assert (select cancelled_at from public.user_invitations where user_id = s2) is not null;
  perform pg_temp.act_as(s2);
  assert not public.is_active_user();

  -- The new invitation: Sent, the 24 hours from now, no access until it's accepted (the account has no password
  -- anyone knows; the database lets them in only once they sign in through the link).
  perform pg_temp.act_as(admin);
  perform public.record_invitation_sent(s2, new_ref);
  perform pg_temp.as_owner();
  assert exists (select 1 from public.user_invitations where user_id = s2 and cancelled_at is null and activated_at is null
    and sent_at > now() - interval '1 minute' and link_ref = new_ref), 'Sent again';
  perform pg_temp.act_as(admin);
  assert exists (select 1 from public.get_staff_invitations() s where s.user_id = s2 and not s.expired and not s.cancelled), 'on Sent Invitations';
  perform pg_temp.act_as(legacy);
  assert s2 || ':false' = any (pg_temp.unactivated()), 'still not assignable';

  -- Old links stay dead: the cancelled one still says cancelled, the new one is valid.
  perform pg_temp.act_as(null, 'service_role');
  assert public.invitation_link_state(old_ref) = 'cancelled', 'a link of the cancelled invitation stays cancelled';
  assert public.invitation_link_state(new_ref) = 'valid';

  -- Accepting it: activated, assignable, and on Active Staff (off Sent Invitations).
  perform pg_temp.act_as(s2);
  perform public.mark_account_activated();
  assert public.is_active_user();
  perform pg_temp.act_as(admin);
  assert not exists (select 1 from public.get_staff_invitations() s where s.user_id = s2);
  perform pg_temp.act_as(legacy);
  assert not (s2 || ':false' = any (pg_temp.unactivated()));
  perform pg_temp.as_owner();
  insert into public.sop_co_authors (sop_id, user_id, added_by) values (sop, s2, author);
  perform pg_temp.act_as(null, 'service_role');
  assert public.invitation_link_state(new_ref) = 'used';
  assert public.invitation_link_state(old_ref) = 'cancelled';

  -- Add Staff with an activated person's email is taken again.
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error($q$select public.check_new_user('ri-2@test.invalid', 'X', '+966512345702', 'Officer', 'pharmacovigilance', array['author'])$q$, '23514', 'email-taken');

  -- Legacy people are unchanged everywhere.
  perform pg_temp.act_as(legacy);
  assert public.is_active_user();
  perform pg_temp.as_owner();
  assert not exists (select 1 from public.user_invitations where user_id = legacy);
end;
$$;

rollback;
