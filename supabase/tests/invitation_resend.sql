-- Tests for 20261112130000_invitation_resend.sql: recording invitations, activation, who is notified of
-- an expired one, and resending (claim and revert). Every call is made as the API would make it (role
-- anon or authenticated, with the caller's id in the JWT claims). Only for a disposable LOCAL database
-- with every migration applied; never the shared project. Everything is rolled back.
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
-- The ids of the caller's expired-invitation notifications.
create function pg_temp.mine() returns uuid[]
language sql as $$ select coalesce(array_agg(e.user_id order by e.user_id), '{}') from public.get_my_expired_invitations() e $$;
-- Makes the person's current link a day and an hour old (as the owner).
create function pg_temp.age(p_user uuid) returns void
language plpgsql as $$
begin
  update public.user_invitations set sent_at = now() - interval '25 hours' where user_id = p_user;
end;
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(),
  pg_temp.mine(), pg_temp.age(uuid) to public;

-- People: 1 the Super Admin, 2-3 Admins, 4-7 staff (7 is banned).
insert into auth.users (id, email)
select ('9d000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'ir-' || n || '@test.invalid' from generate_series(1, 7) n;
update auth.users set banned_until = now() + interval '1 year' where id = '9d000000-0000-4000-8000-000000000007';
insert into public.departments (id, name, initials) values ('ir-home', 'IR Home', 'IH') on conflict do nothing;
insert into public.profiles (id, full_name, email, initials, department_id, "position")
select ('9d000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'IR Person ' || n, 'ir-' || n || '@test.invalid', 'IP',
       case when n >= 4 then 'ir-home' end, case when n >= 4 then 'Specialist' end
from generate_series(1, 7) n;
insert into public.user_roles (user_id, role)
select ('9d000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, case when n <= 3 then 'admin' else 'author' end::public.app_role
from generate_series(1, 7) n;
-- Person 1 is the Super Admin (any earlier designation is replaced; rolled back). No other Admin
-- in this database counts: earlier fixtures' Admins are ended for this test (rolled back).
alter table public.organizations disable trigger user;
update public.organizations set super_admin_id = null, super_admin_assigned_at = null;
alter table public.organizations enable trigger user;
update public.profiles p set deleted_at = now()
where p.deleted_at is null and p.id::text not like '9d000000-%'
  and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin');
update public.organizations set super_admin_id = '9d000000-0000-4000-8000-000000000001', super_admin_assigned_at = now();

do $$
declare
  sa constant uuid := '9d000000-0000-4000-8000-000000000001';
  a2 constant uuid := '9d000000-0000-4000-8000-000000000002';
  a3 constant uuid := '9d000000-0000-4000-8000-000000000003';
  s4 constant uuid := '9d000000-0000-4000-8000-000000000004';
  s5 constant uuid := '9d000000-0000-4000-8000-000000000005';
  s6 constant uuid := '9d000000-0000-4000-8000-000000000006';
  s7 constant uuid := '9d000000-0000-4000-8000-000000000007';
  v_claim jsonb;
  v_row public.user_invitations;
begin
  -- ---------- Grants: the table is closed; only signed-in users may call the functions ----------
  assert not has_table_privilege('authenticated', 'public.user_invitations', 'select'), 'not readable directly';
  assert not has_table_privilege('authenticated', 'public.user_invitations', 'update'), 'not writable directly';
  assert not has_table_privilege('service_role', 'public.user_invitations', 'select');
  assert (select relrowsecurity from pg_class where oid = 'public.user_invitations'::regclass), 'RLS is on';
  -- No policy that lets anyone read or write it (only the restrictive "Same organization only", 20261116150000).
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_invitations' and permissive = 'PERMISSIVE'), 'no policies';
  assert not has_function_privilege('anon', 'public.claim_invitation_resend(uuid)', 'execute');
  assert not has_function_privilege('anon', 'public.get_my_expired_invitations()', 'execute');
  assert not has_function_privilege('anon', 'public.mark_account_activated()', 'execute');
  assert not has_function_privilege('authenticated', 'public.invitation_lifetime()', 'execute'), 'internal';
  assert has_function_privilege('authenticated', 'public.claim_invitation_resend(uuid)', 'execute');

  -- ---------- Recording: only Admins, only for people who exist ----------
  perform pg_temp.act_as(s5);
  perform pg_temp.expect_error(format('select public.record_invitation_sent(%L)', s4), '42501', 'forbidden');
  perform pg_temp.expect_error('select public.get_my_expired_invitations()', '42501', 'forbidden');
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', s4), '42501', 'forbidden');
  perform pg_temp.act_as(a2);
  perform pg_temp.expect_error($q$select public.record_invitation_sent('9d000000-0000-4000-8000-0000000000ff')$q$, 'P0002', 'not-found');
  perform public.record_invitation_sent(s4);
  perform public.record_invitation_sent(s5);
  perform pg_temp.act_as(a3);
  perform public.record_invitation_sent(s6);
  perform public.record_invitation_sent(s7);
  perform pg_temp.as_owner();
  select * into v_row from public.user_invitations where user_id = s4;
  assert v_row.sent_by = a2 and v_row.sent_at > now() - interval '1 minute' and v_row.activated_at is null, 'recorded with the sender';
  perform pg_temp.act_as(null, 'anon');
  perform pg_temp.expect_error('select public.get_my_expired_invitations()', '42501');

  -- ---------- A valid link: no notification, and Resend is refused ----------
  perform pg_temp.act_as(a2);
  assert pg_temp.mine() = '{}', 'nothing while the link is valid';
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', s4), '23514', 'still-valid');

  -- ---------- Expired: only the sender is notified ----------
  perform pg_temp.as_owner();
  perform pg_temp.age(s4); perform pg_temp.age(s5); perform pg_temp.age(s6); perform pg_temp.age(s7);
  perform pg_temp.act_as(a2);
  assert pg_temp.mine() = array[s4, s5], 'the sender sees their expired invitations';
  assert (select e.name = 'IR Person 4' and e.email = 'ir-4@test.invalid' and e.kind = 'staff'
            and e.expired_at = e.sent_at + interval '24 hours'
          from public.get_my_expired_invitations() e where e.user_id = s4), 'name, sign-in email, kind and expiry';
  perform pg_temp.act_as(a3);
  assert pg_temp.mine() = array[s6], 'not a banned account (it could not be resent)';
  perform pg_temp.act_as(sa);
  assert pg_temp.mine() = '{}', 'the Super Admin sees none of them';

  -- ---------- Activation: only the person's own, and only after the current link ----------
  perform pg_temp.act_as(s5);
  perform public.mark_account_activated();
  perform public.mark_account_activated();
  perform pg_temp.as_owner();
  assert (select activated_at is not null from public.user_invitations where user_id = s5), 'activated';
  assert (select activated_at is null from public.user_invitations where user_id = s4), 'nobody else is marked';
  perform pg_temp.act_as(a2);
  assert pg_temp.mine() = array[s4], 'gone once activated';
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', s5), '23514', 'already-activated');
  -- Added again later: a new link, so not activated until a new mark.
  perform public.record_invitation_sent(s5);
  perform pg_temp.as_owner();
  perform pg_temp.age(s5);
  perform pg_temp.act_as(a2);
  assert pg_temp.mine() = array[s4, s5], 'a new link starts over';

  -- ---------- Resend: claim, a second claim is refused, revert only for that claim ----------
  perform pg_temp.act_as(a3);
  v_claim := public.claim_invitation_resend(s4);
  assert v_claim ->> 'email' = 'ir-4@test.invalid', 'the email comes from the account';
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', s4), '23514', 'still-valid');
  perform pg_temp.as_owner();
  select * into v_row from public.user_invitations where user_id = s4;
  assert v_row.sent_by = a3 and v_row.previous_sent_by = a2 and v_row.previous_sent_at < v_row.sent_at, 'the resender is the new sender';
  perform pg_temp.act_as(a2);
  assert pg_temp.mine() = array[s5], 'gone once resent (any Admin may resend)';
  assert not public.revert_invitation_resend(s4, now() - interval '1 hour'), 'another claim: nothing reverted';
  assert public.revert_invitation_resend(s4, (v_claim ->> 'claimedAt')::timestamptz), 'this claim: reverted';
  assert not public.revert_invitation_resend(s4, (v_claim ->> 'claimedAt')::timestamptz), 'only once';
  assert pg_temp.mine() = array[s4, s5], 'back after a failed send';

  -- ---------- A resent link that expires again notifies again (the resender) ----------
  perform pg_temp.act_as(a3);
  v_claim := public.claim_invitation_resend(s4);
  perform pg_temp.as_owner();
  perform pg_temp.age(s4);
  perform pg_temp.act_as(a3);
  assert pg_temp.mine() = array[s4, s6], 'the resender is notified next time';
  assert (select e.sent_at < now() - interval '24 hours' from public.get_my_expired_invitations() e where e.user_id = s4), 'a new sending';

  -- ---------- The sender is no longer an Admin: the Super Admin; without one, every Admin ----------
  perform pg_temp.as_owner();
  update public.profiles set deleted_at = now() where id = a3;
  perform pg_temp.act_as(sa);
  assert pg_temp.mine() = array[s4, s6], 'the Super Admin takes over';
  perform pg_temp.act_as(a2);
  assert pg_temp.mine() = array[s5], 'not another Admin';
  perform pg_temp.as_owner();
  alter table public.organizations disable trigger user;
  update public.organizations set super_admin_id = null, super_admin_assigned_at = null;
  alter table public.organizations enable trigger user;
  perform pg_temp.act_as(a2);
  assert pg_temp.mine() = array[s4, s5, s6], 'no Super Admin: every Admin';
  perform pg_temp.act_as(sa);
  assert pg_temp.mine() = array[s4, s6], 'including the former Super Admin, for the orphaned ones';
  perform pg_temp.as_owner();
  update public.organizations set super_admin_id = sa, super_admin_assigned_at = now();

  -- ---------- Deleted, blocked, unknown and the Super Admin's own account ----------
  update public.profiles set deleted_at = now() where id = s6;
  perform pg_temp.act_as(sa);
  assert pg_temp.mine() = array[s4], 'gone once the person is deleted';
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', s6), 'P0002', 'not-found');
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', s7), '23514', 'account-blocked');
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', sa), 'P0002', 'no-invitation');
  perform public.record_invitation_sent(sa);
  perform pg_temp.as_owner();
  perform pg_temp.age(sa);
  perform pg_temp.act_as(a2);
  perform pg_temp.expect_error(format('select public.claim_invitation_resend(%L)', sa), '42501', 'super-admin-required');
  perform pg_temp.act_as(sa);
  assert public.claim_invitation_resend(sa) ->> 'email' = 'ir-1@test.invalid', 'the Super Admin may, for their own account';
end;
$$;

rollback;
