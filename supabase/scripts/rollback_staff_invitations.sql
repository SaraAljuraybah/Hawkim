-- Undoes 20261122120000_staff_invitations.sql: drops its functions, index and columns, and puts back the
-- functions it changed as 20261112130000_invitation_resend.sql / 20261116160000_scope_staff_functions.sql
-- left them. The audit rows it wrote (organization_management_audit, invitation-* actions) are kept.
-- Data loss: which invitations were cancelled, and the links' references.
-- A cancelled person's sign-in account stays blocked in Auth (unblock it there if they should be invited again).
begin;

drop function if exists public.invitation_link_state(uuid);
drop function if exists public.undo_invitation_cancel(uuid, timestamptz);
drop function if exists public.cancel_invitation(uuid);
drop function if exists public.get_staff_invitations();

create or replace function public.is_active_user() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.deleted_at is null
  );
$$;

drop function if exists public.record_invitation_sent(uuid, uuid);
create function public.record_invitation_sent(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.organization_id = public.current_organization_id()
    and p.deleted_at is null) then
    raise exception 'No such person' using errcode = 'P0002', hint = 'not-found';
  end if;
  insert into public.user_invitations (user_id, sent_at, sent_by)
  values (p_user_id, pg_catalog.now(), (select auth.uid()))
  on conflict (user_id) do update
    set sent_at = excluded.sent_at, sent_by = excluded.sent_by, activated_at = null,
        previous_sent_at = null, previous_sent_by = null;
end;
$$;

create or replace function public.claim_invitation_resend(p_user_id uuid) returns jsonb
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
  perform 1 from public.profiles p where p.id = p_user_id and p.organization_id = public.current_organization_id()
    and p.deleted_at is null for update;
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

create or replace function public.revert_invitation_resend(p_user_id uuid, p_claimed_at timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  update public.user_invitations i
  set sent_at = i.previous_sent_at, sent_by = i.previous_sent_by, previous_sent_at = null, previous_sent_by = null
  where i.user_id = p_user_id and i.organization_id = public.current_organization_id() and i.sent_at = p_claimed_at and i.previous_sent_at is not null;
  return found;
end;
$$;

drop function if exists public.mark_account_activated();
create function public.mark_account_activated() returns void
language sql security definer set search_path = '' as $$
  update public.user_invitations i set activated_at = pg_catalog.now()
  where i.user_id = (select auth.uid())
    and (i.activated_at is null or i.activated_at < i.sent_at)
    and exists (select 1 from public.profiles p where p.id = i.user_id and p.deleted_at is null);
$$;

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
      and (i.activated_at is null or i.activated_at < i.sent_at)
      and pg_catalog.now() >= i.sent_at + public.invitation_lifetime()
      and case
        when i.sent_by is not null and public.is_active_admin(i.sent_by) then i.sent_by = me
        when chief_active then chief = me
        else true -- No active sender or Super Admin: every active Admin (the caller is one).
      end
    order by i.sent_at, i.user_id;
end;
$$;

drop function if exists public.invitation_pending(public.user_invitations);
drop index if exists public.organization_management_audit_invitation_link_ref;
drop index if exists public.user_invitations_link_ref_key;
alter table public.user_invitations
  drop column if exists cancelled_by,
  drop column if exists cancelled_at,
  drop column if exists previous_link_ref,
  drop column if exists link_ref;

alter function public.is_active_user() owner to postgres;
alter function public.record_invitation_sent(uuid) owner to postgres;
alter function public.claim_invitation_resend(uuid) owner to postgres;
alter function public.revert_invitation_resend(uuid, timestamptz) owner to postgres;
alter function public.mark_account_activated() owner to postgres;
alter function public.get_my_expired_invitations() owner to postgres;
revoke all on function public.record_invitation_sent(uuid), public.mark_account_activated() from public, anon, authenticated, service_role;
grant execute on function public.record_invitation_sent(uuid), public.mark_account_activated() to authenticated;

notify pgrst, 'reload schema';

commit;
