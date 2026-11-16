-- Sent Invitations (Staff page) and Cancel invitation.
--
-- Builds on 20261112130000_invitation_resend.sql (user_invitations, Resend invitation) as scoped to the
-- caller's organization by 20261116160000_scope_staff_functions.sql. Additive: no existing row is
-- changed, and people without an invitation record keep working exactly as before.
--
-- - user_invitations gains link_ref (a random reference put in the emailed link's address, so Set New
--   Password can tell a cancelled invitation from an expired one; it is not a token and grants nothing),
--   previous_link_ref (undoing a failed resend), and cancelled_at / cancelled_by.
-- - The audit history goes to the existing organization_management_audit table (actions invitation-sent,
--   invitation-resent, invitation-resend-undone, invitation-cancelled, invitation-cancel-undone and
--   invitation-activated; entity_id is the person). No link, token or password is ever stored.
-- - get_staff_invitations: the Sent Invitations tab (staff only, the caller's organization only).
-- - cancel_invitation / undo_invitation_cancel: the cancel-invitation Edge Function, as the calling Admin.
--   That function then blocks the sign-in account in Auth (ban, and a password nobody knows, which ends
--   every link issued before).
-- - invitation_link_state: Set New Password, for anyone holding a link (through the public invitation-link-state
--   Edge Function, so signed-out callers still reach no database function): cancelled, replaced, expired, used or valid.
-- - is_active_user: a cancelled invitation's person is not an active user (row level security everywhere),
--   whatever their sign-in account still holds.
-- - record_invitation_sent takes the link's reference (optional, so the deployed add-user keeps working);
--   claim_invitation_resend refuses a cancelled invitation and makes the new link's reference;
--   revert_invitation_resend puts the reference back; mark_account_activated ignores a cancelled
--   invitation; get_my_expired_invitations leaves cancelled invitations out.
--
-- Rollback: supabase/scripts/rollback_staff_invitations.sql.

begin;

alter table public.user_invitations
  add column link_ref uuid,
  add column previous_link_ref uuid,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles (id) on delete set null;

create unique index user_invitations_link_ref_key on public.user_invitations (link_ref) where link_ref is not null;
-- invitation_link_state finds a replaced link's person through its audit row.
create index organization_management_audit_invitation_link_ref on public.organization_management_audit ((details ->> 'linkRef'))
  where action in ('invitation-sent', 'invitation-resent');

-- Whether the person's current invitation is still waiting to be activated.
create function public.invitation_pending(i public.user_invitations) returns boolean
language sql immutable set search_path = '' as $$
  select i.activated_at is null or i.activated_at < i.sent_at
$$;

-- ---------- Access: a cancelled invitation's person is not an active user ----------

create or replace function public.is_active_user() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.deleted_at is null
      and not exists (select 1 from public.user_invitations i where i.user_id = p.id and i.cancelled_at is not null)
  );
$$;

-- ---------- Add Staff / Add Admin: the invitation was emailed ----------

drop function public.record_invitation_sent(uuid);
create function public.record_invitation_sent(p_user_id uuid, p_link_ref uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.organization_id = public.current_organization_id()
    and p.deleted_at is null) then
    raise exception 'No such person' using errcode = 'P0002', hint = 'not-found';
  end if;
  insert into public.user_invitations (user_id, sent_at, sent_by, link_ref)
  values (p_user_id, pg_catalog.now(), (select auth.uid()), p_link_ref)
  on conflict (user_id) do update
    set sent_at = excluded.sent_at, sent_by = excluded.sent_by, activated_at = null, link_ref = excluded.link_ref,
        previous_sent_at = null, previous_sent_by = null, previous_link_ref = null, cancelled_at = null, cancelled_by = null;
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'invitation-sent', p_user_id::text,
    case when p_link_ref is null then '{}'::jsonb else jsonb_build_object('linkRef', p_link_ref) end);
end;
$$;

-- ---------- Resend ----------

-- As before, plus: a cancelled invitation can't be resent, and the new link gets its own reference.
create or replace function public.claim_invitation_resend(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  invitation public.user_invitations;
  account_email text;
  claimed timestamptz := pg_catalog.now();
  new_ref uuid := gen_random_uuid();
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  perform 1 from public.profiles p where p.id = p_user_id and p.organization_id = public.current_organization_id()
    and p.deleted_at is null for update;
  if not found then
    raise exception 'No such person' using errcode = 'P0002', hint = 'not-found';
  end if;
  select * into invitation from public.user_invitations i where i.user_id = p_user_id for update;
  if found and invitation.cancelled_at is not null then
    raise exception 'The invitation was cancelled' using errcode = '23514', hint = 'cancelled';
  end if;
  select u.email into account_email from auth.users u
  where u.id = p_user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until <= pg_catalog.now());
  if account_email is null then
    raise exception 'The account is blocked' using errcode = '23514', hint = 'account-blocked';
  end if;
  if p_user_id = public.super_admin_id() and not public.is_super_admin() then
    raise exception 'Only the Super Admin can do this' using errcode = '42501', hint = 'super-admin-required';
  end if;
  if invitation.user_id is null then
    raise exception 'No invitation recorded' using errcode = 'P0002', hint = 'no-invitation';
  end if;
  if not public.invitation_pending(invitation) then
    raise exception 'Already activated' using errcode = '23514', hint = 'already-activated';
  end if;
  if claimed < invitation.sent_at + public.invitation_lifetime() then
    raise exception 'The invitation is still valid' using errcode = '23514', hint = 'still-valid';
  end if;
  update public.user_invitations i
  set previous_sent_at = i.sent_at, previous_sent_by = i.sent_by, previous_link_ref = i.link_ref,
      sent_at = claimed, sent_by = me, activated_at = null, link_ref = new_ref
  where i.user_id = p_user_id;
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values (me, 'invitation-resent', p_user_id::text, jsonb_build_object('linkRef', new_ref));
  return jsonb_build_object('email', account_email, 'claimedAt', claimed, 'linkRef', new_ref);
end;
$$;

create or replace function public.revert_invitation_resend(p_user_id uuid, p_claimed_at timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  update public.user_invitations i
  set sent_at = i.previous_sent_at, sent_by = i.previous_sent_by, link_ref = i.previous_link_ref,
      previous_sent_at = null, previous_sent_by = null, previous_link_ref = null
  where i.user_id = p_user_id and i.organization_id = public.current_organization_id() and i.sent_at = p_claimed_at and i.previous_sent_at is not null;
  if found then
    insert into public.organization_management_audit (actor_id, action, entity_id, details)
    values ((select auth.uid()), 'invitation-resend-undone', p_user_id::text, '{}'::jsonb);
  end if;
  return found;
end;
$$;

-- ---------- Activation ----------

-- As before (only the caller's own account), but never a cancelled invitation; recorded in the audit.
drop function public.mark_account_activated();
create function public.mark_account_activated() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  update public.user_invitations i set activated_at = pg_catalog.now()
  where i.user_id = me
    and public.invitation_pending(i)
    and i.cancelled_at is null
    and exists (select 1 from public.profiles p where p.id = i.user_id and p.deleted_at is null);
  if found then
    insert into public.organization_management_audit (actor_id, action, entity_id, details)
    values (me, 'invitation-activated', me::text, '{}'::jsonb);
  end if;
end;
$$;

-- ---------- Bell notifications: cancelled invitations are left out ----------

create or replace function public.get_my_expired_invitations()
returns table (user_id uuid, name text, email text, kind text, sent_at timestamptz, expired_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  chief uuid := public.super_admin_id();
  chief_active boolean := chief is not null and public.is_active_admin(chief);
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  return query
    select i.user_id, p.full_name, u.email::text,
           case when exists (select 1 from public.user_roles r where r.user_id = i.user_id and r.role = 'admin') then 'admin' else 'staff' end,
           i.sent_at, i.sent_at + public.invitation_lifetime()
    from public.user_invitations i
    join public.profiles p on p.id = i.user_id and p.deleted_at is null
    join auth.users u on u.id = i.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until <= pg_catalog.now())
    where i.organization_id = public.current_organization_id()
      and public.invitation_pending(i)
      and i.cancelled_at is null
      and pg_catalog.now() >= i.sent_at + public.invitation_lifetime()
      and case
        when i.sent_by is not null and public.is_active_admin(i.sent_by) then i.sent_by = me
        when chief_active then chief = me
        else true -- No active sender or Super Admin: every active Admin (the caller is one).
      end
    order by i.sent_at, i.user_id;
end;
$$;

-- ---------- Sent Invitations ----------

-- The caller's organization's staff (never Admins) whose invitation isn't activated: still waiting
-- (cancelled = false; expired is decided here, by the database's clock), or cancelled (so the Staff page
-- lists them in no tab). Deactivated staff are on the Deactivated Staff tab, not here.
create function public.get_staff_invitations()
returns table (user_id uuid, sent_at timestamptz, expires_at timestamptz, expired boolean, cancelled boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  return query
    select i.user_id, i.sent_at, i.sent_at + public.invitation_lifetime(),
           pg_catalog.now() >= i.sent_at + public.invitation_lifetime(), i.cancelled_at is not null
    from public.user_invitations i
    join public.profiles p on p.id = i.user_id and p.deleted_at is null and p.organization_id = public.current_organization_id()
    where i.organization_id = public.current_organization_id()
      and public.invitation_pending(i)
      and not exists (select 1 from public.user_roles r where r.user_id = i.user_id and r.role = 'admin')
    order by i.sent_at desc, i.user_id;
end;
$$;

-- ---------- Cancel ----------

-- Cancel, step 1 (before the account is blocked in Auth): under the row's lock, a staff member of the
-- caller's organization whose invitation isn't activated. Returns the cancellation's time; repeating it
-- returns the first one (already = true), so a retry blocks the account again.
create function public.cancel_invitation(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  invitation public.user_invitations;
  stamp timestamptz := pg_catalog.now();
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  perform 1 from public.profiles p where p.id = p_user_id and p.organization_id = public.current_organization_id()
    and p.deleted_at is null for update;
  if not found then
    raise exception 'No such person' using errcode = 'P0002', hint = 'not-found';
  end if;
  if exists (select 1 from public.user_roles r where r.user_id = p_user_id and r.role = 'admin') then
    raise exception 'Admins are managed separately' using errcode = '42501', hint = 'admin-managed-separately';
  end if;
  select * into invitation from public.user_invitations i where i.user_id = p_user_id for update;
  if not found then
    raise exception 'No invitation recorded' using errcode = 'P0002', hint = 'no-invitation';
  end if;
  if invitation.cancelled_at is not null then
    return jsonb_build_object('cancelledAt', invitation.cancelled_at, 'already', true);
  end if;
  if not public.invitation_pending(invitation) then
    raise exception 'Already activated' using errcode = '23514', hint = 'already-activated';
  end if;
  update public.user_invitations i set cancelled_at = stamp, cancelled_by = me where i.user_id = p_user_id;
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values (me, 'invitation-cancelled', p_user_id::text, jsonb_build_object('sentAt', invitation.sent_at));
  return jsonb_build_object('cancelledAt', stamp, 'already', false);
end;
$$;

-- Cancel, undone (the account couldn't be blocked in Auth): only if the row still holds this cancellation.
create function public.undo_invitation_cancel(p_user_id uuid, p_cancelled_at timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  update public.user_invitations i set cancelled_at = null, cancelled_by = null
  where i.user_id = p_user_id and i.organization_id = public.current_organization_id() and i.cancelled_at = p_cancelled_at;
  if found then
    insert into public.organization_management_audit (actor_id, action, entity_id, details)
    values ((select auth.uid()), 'invitation-cancel-undone', p_user_id::text, '{}'::jsonb);
  end if;
  return found;
end;
$$;

-- ---------- Set New Password: what became of a link ----------

-- For anyone holding a link, through the invitation-link-state Edge Function (service role only): 'cancelled', 'replaced' (a newer link was sent),
-- 'expired', 'used' (activated) or 'valid'; 'unknown' for a reference that isn't an invitation's (or a
-- deactivated person's). Says nothing else about the person; the reference is random and grants nothing.
create function public.invitation_link_state(p_link_ref uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  invitation public.user_invitations;
  person uuid;
begin
  if p_link_ref is null then
    return 'unknown';
  end if;
  select * into invitation from public.user_invitations i where i.link_ref = p_link_ref;
  if not found then
    select a.entity_id::uuid into person from public.organization_management_audit a
    where a.action in ('invitation-sent', 'invitation-resent') and a.details ->> 'linkRef' = p_link_ref::text
    order by a.id desc limit 1;
    if person is null then
      return 'unknown';
    end if;
    select * into invitation from public.user_invitations i where i.user_id = person;
    if not found then
      return 'unknown';
    end if;
  end if;
  if not exists (select 1 from public.profiles p where p.id = invitation.user_id and p.deleted_at is null) then
    return 'unknown';
  end if;
  if invitation.cancelled_at is not null then
    return 'cancelled';
  end if;
  if invitation.link_ref is distinct from p_link_ref then
    return 'replaced';
  end if;
  if not public.invitation_pending(invitation) then
    return 'used';
  end if;
  if pg_catalog.now() >= invitation.sent_at + public.invitation_lifetime() then
    return 'expired';
  end if;
  return 'valid';
end;
$$;

alter function public.invitation_pending(public.user_invitations) owner to postgres;
alter function public.is_active_user() owner to postgres;
alter function public.record_invitation_sent(uuid, uuid) owner to postgres;
alter function public.claim_invitation_resend(uuid) owner to postgres;
alter function public.revert_invitation_resend(uuid, timestamptz) owner to postgres;
alter function public.mark_account_activated() owner to postgres;
alter function public.get_my_expired_invitations() owner to postgres;
alter function public.get_staff_invitations() owner to postgres;
alter function public.cancel_invitation(uuid) owner to postgres;
alter function public.undo_invitation_cancel(uuid, timestamptz) owner to postgres;
alter function public.invitation_link_state(uuid) owner to postgres;

revoke all on function public.invitation_pending(public.user_invitations), public.record_invitation_sent(uuid, uuid),
  public.mark_account_activated(), public.get_staff_invitations(), public.cancel_invitation(uuid),
  public.undo_invitation_cancel(uuid, timestamptz), public.invitation_link_state(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_invitation_sent(uuid, uuid), public.mark_account_activated(),
  public.get_staff_invitations(), public.cancel_invitation(uuid), public.undo_invitation_cancel(uuid, timestamptz)
  to authenticated;
grant execute on function public.invitation_link_state(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
