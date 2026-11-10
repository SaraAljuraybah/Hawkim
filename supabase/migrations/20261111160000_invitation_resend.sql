-- Expired invitations and Resend invitation.
--
-- Add User emails an activation link that Auth expires after 24 hours (Email OTP Expiration, 86400s).
-- From now on each invitation is recorded here: when it was sent and by whom, and when the person
-- activated (saved a password, or signed in with one). Only invitations sent after this migration
-- are tracked; nothing is backfilled and no existing row or object is changed (additive only).
--
-- - record_invitation_sent: Add User (the add-user Edge Function, as the calling Admin) after emailing.
-- - mark_account_activated: the signed-in person, for their own account only.
-- - get_my_expired_invitations: the caller's bell notifications. Each expired, unactivated invitation
--   goes to the Admin who sent it; if they are no longer an active Admin, to the Super Admin; if there
--   is no active Super Admin either, to every active Admin.
-- - claim_invitation_resend / revert_invitation_resend: the resend-invitation Edge Function, as the
--   calling Admin (any active Admin may resend; only the Super Admin for the Super Admin's account).
--
-- Depends on 20261111120000_super_admin.sql (super_admin_id, is_active_admin, is_super_admin).

begin;

create table public.user_invitations (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  sent_at timestamptz not null,
  -- The Admin who sent the current link (null once that profile is removed).
  sent_by uuid references public.profiles (id) on delete set null,
  -- When the person saved a password (or signed in with one) after the current link was sent.
  activated_at timestamptz,
  -- The link before a resend in progress, so a failed send can be undone.
  previous_sent_at timestamptz,
  previous_sent_by uuid references public.profiles (id) on delete set null
);

alter table public.user_invitations enable row level security;
-- No policies and no grants: read and changed only through the functions below.
revoke all on table public.user_invitations from public, anon, authenticated, service_role;

-- How long an activation link works: the project's Email OTP Expiration (24 hours).
create function public.invitation_lifetime() returns interval
language sql immutable set search_path = '' as $$ select interval '24 hours' $$;

-- Add User: the invitation to p_user_id was just emailed by the caller.
create function public.record_invitation_sent(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.deleted_at is null) then
    raise exception 'No such person' using errcode = 'P0002', hint = 'not-found';
  end if;
  insert into public.user_invitations (user_id, sent_at, sent_by)
  values (p_user_id, pg_catalog.now(), (select auth.uid()))
  on conflict (user_id) do update
    set sent_at = excluded.sent_at, sent_by = excluded.sent_by, activated_at = null,
        previous_sent_at = null, previous_sent_by = null;
end;
$$;

-- The signed-in person saved a password (or signed in with one): their current invitation is used.
-- Only ever their own account; repeating it changes nothing.
create function public.mark_account_activated() returns void
language sql security definer set search_path = '' as $$
  update public.user_invitations i set activated_at = pg_catalog.now()
  where i.user_id = (select auth.uid())
    and (i.activated_at is null or i.activated_at < i.sent_at)
    and exists (select 1 from public.profiles p where p.id = i.user_id and p.deleted_at is null);
$$;

-- The caller's expired-invitation notifications (see the header for who gets which).
create function public.get_my_expired_invitations()
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
    where (i.activated_at is null or i.activated_at < i.sent_at)
      and pg_catalog.now() >= i.sent_at + public.invitation_lifetime()
      and case
        when i.sent_by is not null and public.is_active_admin(i.sent_by) then i.sent_by = me
        when chief_active then chief = me
        else true -- No active sender or Super Admin: every active Admin (the caller is one).
      end
    order by i.sent_at, i.user_id;
end;
$$;

-- Resend, step 1 (before a new link is made): checks that the invitation can be resent, records the
-- new sending under the row's lock, and returns the account's email and the claim's time. A second
-- click, or a second Admin, then finds a valid link and is refused.
create function public.claim_invitation_resend(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  invitation public.user_invitations;
  account_email text;
  claimed timestamptz := pg_catalog.now();
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  perform 1 from public.profiles p where p.id = p_user_id and p.deleted_at is null for update;
  if not found then
    raise exception 'No such person' using errcode = 'P0002', hint = 'not-found';
  end if;
  select u.email into account_email from auth.users u
  where u.id = p_user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until <= pg_catalog.now());
  if account_email is null then
    raise exception 'The account is blocked' using errcode = '23514', hint = 'account-blocked';
  end if;
  if p_user_id = public.super_admin_id() and not public.is_super_admin() then
    raise exception 'Only the Super Admin can do this' using errcode = '42501', hint = 'super-admin-required';
  end if;
  select * into invitation from public.user_invitations i where i.user_id = p_user_id for update;
  if not found then
    raise exception 'No invitation recorded' using errcode = 'P0002', hint = 'no-invitation';
  end if;
  if invitation.activated_at is not null and invitation.activated_at >= invitation.sent_at then
    raise exception 'Already activated' using errcode = '23514', hint = 'already-activated';
  end if;
  if claimed < invitation.sent_at + public.invitation_lifetime() then
    raise exception 'The invitation is still valid' using errcode = '23514', hint = 'still-valid';
  end if;
  update public.user_invitations i
  set previous_sent_at = i.sent_at, previous_sent_by = i.sent_by, sent_at = claimed, sent_by = me, activated_at = null
  where i.user_id = p_user_id;
  return jsonb_build_object('email', account_email, 'claimedAt', claimed);
end;
$$;

-- Resend, undone (the link couldn't be made or the email couldn't be sent): puts the previous sending
-- back, only if the row still holds this claim.
create function public.revert_invitation_resend(p_user_id uuid, p_claimed_at timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  update public.user_invitations i
  set sent_at = i.previous_sent_at, sent_by = i.previous_sent_by, previous_sent_at = null, previous_sent_by = null
  where i.user_id = p_user_id and i.sent_at = p_claimed_at and i.previous_sent_at is not null;
  return found;
end;
$$;

alter table public.user_invitations owner to postgres;
alter function public.invitation_lifetime() owner to postgres;
alter function public.record_invitation_sent(uuid) owner to postgres;
alter function public.mark_account_activated() owner to postgres;
alter function public.get_my_expired_invitations() owner to postgres;
alter function public.claim_invitation_resend(uuid) owner to postgres;
alter function public.revert_invitation_resend(uuid, timestamptz) owner to postgres;

revoke all on function public.invitation_lifetime(), public.record_invitation_sent(uuid), public.mark_account_activated(),
  public.get_my_expired_invitations(), public.claim_invitation_resend(uuid), public.revert_invitation_resend(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_invitation_sent(uuid), public.mark_account_activated(),
  public.get_my_expired_invitations(), public.claim_invitation_resend(uuid), public.revert_invitation_resend(uuid, timestamptz)
  to authenticated;

commit;
