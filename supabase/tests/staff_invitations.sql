-- Tests for 20261122120000_staff_invitations.sql: Sent Invitations (get_staff_invitations), the link's
-- reference and invitation_link_state, Cancel (cancel_invitation / undo_invitation_cancel), a cancelled
-- person losing access (is_active_user) while keeping their profile, activation, Resend refusing a
-- cancelled invitation, the audit history, and isolation between organizations. Every call is made as the
-- API would make it (role anon or authenticated, with the caller's id in the JWT claims).
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
-- The caller's Sent Invitations rows, as "id:expired:cancelled".
create function pg_temp.listed() returns text[]
language sql as $$
  select coalesce(array_agg(s.user_id::text || ':' || s.expired || ':' || s.cancelled order by s.user_id), '{}') from public.get_staff_invitations() s
$$;
-- Makes the person's current link 25 hours old (as the owner).
create function pg_temp.age(p_user uuid) returns void
language plpgsql as $$
begin
  update public.user_invitations set sent_at = now() - interval '25 hours' where user_id = p_user;
end;
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(),
  pg_temp.listed(), pg_temp.age(uuid) to public;

-- MedCare (the seed's organization): 1 an Admin, 2-5 staff (5 deactivated), 6 a second Admin (invited).
-- Other: 7 its Admin, 8 its staff member.
insert into auth.users (id, email, aud, role)
select ('9e100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'si-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 8) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
select ('9e100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'SI Person ' || n, 'si-' || n || '@test.invalid', 'SP',
       case when n in (1, 6) then null else 'pharmacovigilance' end, '+96651234560' || n, case when n in (1, 6) then null else 'Officer' end
from generate_series(1, 6) n;
insert into public.user_roles (user_id, role)
select ('9e100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, case when n in (1, 6) then 'admin' else 'author' end::public.app_role
from generate_series(1, 6) n;
insert into public.user_roles (user_id, role) values ('9e100000-0000-4000-8000-000000000003', 'reviewer');

insert into public.organizations (id, name) values ('9e100000-0000-4000-8000-0000000000aa', 'SI Other');
insert into public.divisions (id, name, organization_id) values ('si-other-department-division', 'Other Division', '9e100000-0000-4000-8000-0000000000aa');
insert into public.departments (id, name, initials, organization_id, division_id)
values ('si-other-department', 'SI Other Department', 'SOD', '9e100000-0000-4000-8000-0000000000aa', 'si-other-department-division');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id) values
  ('9e100000-0000-4000-8000-000000000007', 'SI Other Admin', 'si-7@test.invalid', 'OA', null, '+966512345607', null, '9e100000-0000-4000-8000-0000000000aa'),
  ('9e100000-0000-4000-8000-000000000008', 'SI Other Staff', 'si-8@test.invalid', 'OS', 'si-other-department', '+966512345608', 'Officer', '9e100000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values
  ('9e100000-0000-4000-8000-000000000007', 'admin'), ('9e100000-0000-4000-8000-000000000008', 'author');
set constraints all immediate;
set constraints all deferred;

do $$
declare
  admin constant uuid := '9e100000-0000-4000-8000-000000000001';
  s2 constant uuid := '9e100000-0000-4000-8000-000000000002';
  s3 constant uuid := '9e100000-0000-4000-8000-000000000003';
  s4 constant uuid := '9e100000-0000-4000-8000-000000000004';
  s5 constant uuid := '9e100000-0000-4000-8000-000000000005';
  a6 constant uuid := '9e100000-0000-4000-8000-000000000006';
  other_admin constant uuid := '9e100000-0000-4000-8000-000000000007';
  other_staff constant uuid := '9e100000-0000-4000-8000-000000000008';
  ref2 constant uuid := '9e100000-0000-4000-8000-0000000000f2';
  ref3 constant uuid := '9e100000-0000-4000-8000-0000000000f3';
  ref8 constant uuid := '9e100000-0000-4000-8000-0000000000f8';
  v_claim jsonb;
  v_cancel jsonb;
  v_row public.user_invitations;
  v_count int;
begin
  -- ---------- Grants ----------
  assert not has_function_privilege('anon', 'public.get_staff_invitations()', 'execute');
  assert not has_function_privilege('anon', 'public.cancel_invitation(uuid)', 'execute');
  assert not has_function_privilege('anon', 'public.undo_invitation_cancel(uuid, timestamptz)', 'execute');
  assert not has_function_privilege('anon', 'public.invitation_link_state(uuid)', 'execute'), 'signed out: only through its Edge Function';
  assert not has_function_privilege('authenticated', 'public.invitation_link_state(uuid)', 'execute');
  assert has_function_privilege('service_role', 'public.invitation_link_state(uuid)', 'execute');
  assert not has_function_privilege('authenticated', 'public.invitation_pending(public.user_invitations)', 'execute');
  assert not has_table_privilege('authenticated', 'public.user_invitations', 'select');
  assert not has_table_privilege('authenticated', 'public.organization_management_audit', 'select');

  -- ---------- Sending: the link's reference is recorded, with an audit row (never a token) ----------
  perform pg_temp.act_as(admin);
  perform public.record_invitation_sent(s2, ref2);
  perform public.record_invitation_sent(s3, ref3);
  perform public.record_invitation_sent(s4);              -- the add-user deployed before this migration (no reference)
  perform public.record_invitation_sent(a6, gen_random_uuid());
  perform pg_temp.act_as(other_admin);
  perform public.record_invitation_sent(other_staff, ref8);
  perform pg_temp.as_owner();
  select * into v_row from public.user_invitations where user_id = s2;
  assert v_row.link_ref = ref2 and v_row.cancelled_at is null, 'the reference is recorded';
  assert (select link_ref from public.user_invitations where user_id = s4) is null, 'no reference: still tracked';
  assert exists (select 1 from public.organization_management_audit a where a.action = 'invitation-sent' and a.entity_id = s2::text
    and a.actor_id = admin and a.details = jsonb_build_object('linkRef', ref2)), 'sending is audited';
  assert (select a.organization_id from public.organization_management_audit a where a.action = 'invitation-sent' and a.entity_id = other_staff::text)
    = '9e100000-0000-4000-8000-0000000000aa', 'the other organization''s audit row is its own';
  assert not exists (select 1 from public.organization_management_audit a where a.action like 'invitation-%'
    and exists (select 1 from jsonb_object_keys(a.details) k where k not in ('linkRef', 'sentAt'))), 'audit details hold no token or link';

  -- A deactivated staff member with a waiting invitation (deactivated afterwards).
  insert into public.user_invitations (user_id, sent_at, sent_by) values (s5, now(), admin);
  update public.profiles set deleted_at = now() where id = s5;

  -- ---------- Sent Invitations: staff only, waiting only, this organization only ----------
  perform pg_temp.act_as(admin);
  assert pg_temp.listed() = array[s2 || ':false:false', s3 || ':false:false', s4 || ':false:false'],
    'staff with a waiting invitation; never Admins (6), deactivated staff (5) or another organization (8): ' || pg_temp.listed()::text;
  perform pg_temp.act_as(other_admin);
  assert pg_temp.listed() = array[other_staff || ':false:false'], 'the other organization sees only its own';
  perform pg_temp.act_as(s2);
  perform pg_temp.expect_error('select public.get_staff_invitations()', '42501', 'forbidden');
  perform pg_temp.act_as(null, 'anon');
  perform pg_temp.expect_error('select public.get_staff_invitations()', '42501');

  -- ---------- Expiry: decided by the database's clock, exactly 24 hours after sending ----------
  perform pg_temp.as_owner();
  update public.user_invitations set sent_at = now() - interval '23 hours 59 minutes' where user_id = s3;
  perform pg_temp.act_as(admin);
  assert s3 || ':false:false' = any (pg_temp.listed()), 'still Sent just before 24 hours';
  perform pg_temp.as_owner();
  update public.user_invitations set sent_at = now() - interval '24 hours' where user_id = s3;
  perform pg_temp.act_as(admin);
  assert s3 || ':true:false' = any (pg_temp.listed()), 'Expired at 24 hours';
  perform pg_temp.act_as(null, 'service_role');
  assert public.invitation_link_state(ref3) = 'expired';
  assert public.invitation_link_state(ref2) = 'valid';
  assert public.invitation_link_state(gen_random_uuid()) = 'unknown';
  assert public.invitation_link_state(null) = 'unknown';

  -- ---------- Resend: a new reference; the old link is replaced; a failed resend puts it back ----------
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', s2), '23514', 'still-valid');
  v_claim := public.claim_invitation_resend(s3);
  assert (v_claim ->> 'linkRef')::uuid is distinct from ref3, 'a new reference';
  assert s3 || ':false:false' = any (pg_temp.listed()), 'Sent again, from the new sending';
  perform pg_temp.act_as(null, 'service_role');
  assert public.invitation_link_state(ref3) = 'replaced', 'the previous link is replaced';
  assert public.invitation_link_state((v_claim ->> 'linkRef')::uuid) = 'valid';
  perform pg_temp.act_as(admin);
  assert public.revert_invitation_resend(s3, (v_claim ->> 'claimedAt')::timestamptz), 'a failed send is undone';
  perform pg_temp.as_owner();
  select * into v_row from public.user_invitations where user_id = s3;
  assert v_row.link_ref = ref3 and v_row.sent_at < now() - interval '23 hours', 'the previous sending and reference are back';
  assert exists (select 1 from public.organization_management_audit where action = 'invitation-resent' and entity_id = s3::text);
  assert exists (select 1 from public.organization_management_audit where action = 'invitation-resend-undone' and entity_id = s3::text);

  -- ---------- Activation: the person moves off Sent Invitations ----------
  perform pg_temp.act_as(s4);
  perform public.mark_account_activated();
  perform pg_temp.act_as(admin);
  assert not (s4 || ':false:false' = any (pg_temp.listed())), 'an activated person is no longer listed';
  perform pg_temp.as_owner();
  assert exists (select 1 from public.organization_management_audit where action = 'invitation-activated' and entity_id = s4::text and actor_id = s4);
  perform pg_temp.act_as(s4);
  perform public.mark_account_activated();
  perform pg_temp.as_owner();
  select count(*) into v_count from public.organization_management_audit where action = 'invitation-activated' and entity_id = s4::text;
  assert v_count = 1, 'repeating it records nothing';

  -- ---------- Cancel: refusals ----------
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(format('select public.cancel_invitation(%L)', s4), '23514', 'already-activated');
  perform pg_temp.expect_error(format('select public.cancel_invitation(%L)', a6), '42501', 'admin-managed-separately');
  perform pg_temp.expect_error(format('select public.cancel_invitation(%L)', other_staff), 'P0002', 'not-found');
  perform pg_temp.expect_error(format('select public.cancel_invitation(%L)', s5), 'P0002', 'not-found');
  perform pg_temp.expect_error(format('select public.cancel_invitation(%L)', gen_random_uuid()), 'P0002', 'not-found');
  perform pg_temp.act_as(s2);
  perform pg_temp.expect_error(format('select public.cancel_invitation(%L)', s3), '42501', 'forbidden');
  perform pg_temp.act_as(other_admin);
  perform pg_temp.expect_error(format('select public.cancel_invitation(%L)', s2), 'P0002', 'not-found');
  perform pg_temp.as_owner();
  delete from public.user_invitations where user_id = s4;
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(format('select public.cancel_invitation(%L)', s4), 'P0002', 'no-invitation');

  -- ---------- Cancel, undone when the account couldn't be blocked ----------
  v_cancel := public.cancel_invitation(s2);
  assert v_cancel ->> 'already' = 'false';
  assert not public.undo_invitation_cancel(s2, now() - interval '1 hour'), 'only the same cancellation is undone';
  assert public.undo_invitation_cancel(s2, (v_cancel ->> 'cancelledAt')::timestamptz);
  assert s2 || ':false:false' = any (pg_temp.listed()), 'waiting again';
  perform pg_temp.act_as(other_admin);
  assert not public.undo_invitation_cancel(s3, now()), 'never another organization''s';

  -- ---------- Cancel ----------
  perform pg_temp.act_as(admin);
  v_cancel := public.cancel_invitation(s2);
  assert public.cancel_invitation(s2) ->> 'already' = 'true', 'a repeated request finds the same cancellation';
  assert (public.cancel_invitation(s2) ->> 'cancelledAt') = (v_cancel ->> 'cancelledAt');
  assert s2 || ':false:true' = any (pg_temp.listed()), 'listed as cancelled (so the Staff page shows them on no tab)';
  perform pg_temp.as_owner();
  select * into v_row from public.user_invitations where user_id = s2;
  assert v_row.cancelled_by = admin and v_row.cancelled_at is not null;
  assert (select deleted_at from public.profiles where id = s2) is null, 'the profile is not deactivated';
  assert exists (select 1 from public.profiles where id = s2 and full_name = 'SI Person 2' and phone = '+966512345602'), 'their information is kept';
  assert (select count(*) from public.user_roles where user_id = s2) = 1, 'their permission is kept';
  assert exists (select 1 from public.organization_management_audit where action = 'invitation-cancelled' and entity_id = s2::text and actor_id = admin);
  assert exists (select 1 from public.organization_management_audit where action = 'invitation-cancel-undone' and entity_id = s2::text);

  -- The cancelled link says so (the current one, and an older one).
  perform pg_temp.act_as(null, 'service_role');
  assert public.invitation_link_state(ref2) = 'cancelled';

  -- No access: not an active user (row level security everywhere), activation does nothing.
  perform pg_temp.act_as(s2);
  assert not public.is_active_user(), 'a cancelled invitation''s person is not an active user';
  select count(*) into v_count from public.profiles;
  assert v_count = 0, 'they can read nothing';
  perform public.mark_account_activated();
  perform pg_temp.as_owner();
  assert (select activated_at from public.user_invitations where user_id = s2) is null, 'never activated after cancelling';
  -- Everyone else keeps their access.
  perform pg_temp.act_as(s3);
  assert public.is_active_user(), 'a waiting invitation''s person is unchanged';
  perform pg_temp.act_as(s4);
  assert public.is_active_user(), 'an activated person is unchanged';

  -- Resend refuses it, and the bell leaves it out.
  perform pg_temp.as_owner();
  perform pg_temp.age(s2);
  perform pg_temp.act_as(admin);
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', s2), '23514', 'cancelled');
  assert not exists (select 1 from public.get_my_expired_invitations() e where e.user_id = s2), 'no expired-invitation notification';

  -- A new invitation (record_invitation_sent) starts over, not cancelled.
  perform public.record_invitation_sent(s2, gen_random_uuid());
  perform pg_temp.as_owner();
  assert (select cancelled_at from public.user_invitations where user_id = s2) is null;
  perform pg_temp.act_as(s2);
  assert public.is_active_user();
end;
$$;

rollback;
