-- Undoes 20261123120000_staff_invitations_reinvite.sql: drops its triggers and functions, and puts back
-- check_new_user and add_user as 20261121120000_admin_reactivation.sql left them and invitation_link_state as
-- 20261122120000_staff_invitations.sql left it. Kept: the one-time activation backfill (activated_at set from a
-- sign-in after the invitation) and every audit row. People re-invited meanwhile keep their new invitation.
-- Run it before rollback_staff_invitations.sql when undoing both.
begin;

drop trigger if exists zz_review_requests_activated_reviewer on public.review_requests;
drop trigger if exists zz_sop_co_authors_activated_co_author on public.sop_co_authors;
drop function if exists public.guard_activated_assignee();
drop function if exists public.get_unactivated_people();
drop function if exists public.is_invitation_cancelled(uuid);

CREATE OR REPLACE FUNCTION public.check_new_user(p_email text, p_full_name text, p_phone text, p_position text, p_department_id text, p_roles text[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  quality boolean;
  system_admin boolean := p_roles is not null and 'admin' = any (p_roles);
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_email is null or p_email <> lower(btrim(p_email)) or char_length(p_email) > 254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or char_length(btrim(coalesce(p_full_name, ''))) not between 1 and 100
    or p_phone is null or p_phone !~ '^\+9665[0-9]{8}$'
    or (not system_admin and char_length(btrim(coalesce(p_position, ''))) not between 1 and 100)
    or (not system_admin and p_department_id is null) or p_roles is null
    or not p_roles <@ array['author', 'reviewer', 'approver', 'admin'] then
    raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
  end if;
  if exists (select 1 from public.profiles p where p.email = p_email and p.deleted_at is null) then
    raise exception 'A user with this email already exists' using errcode = '23514', hint = 'email-taken';
  end if;
  -- One account belongs to one organization: the email of another organization's person, active or
  -- deactivated, is taken too (so add-user never touches that person's sign-in account).
  if exists (select 1 from public.profiles p where p.email = p_email
             and p.organization_id is distinct from public.current_organization_id()) then
    raise exception 'A user with this email already exists' using errcode = '23514', hint = 'email-taken';
  end if;
  -- Add Admin: a deleted Admin of this organization is brought back with Reactivate Admin instead (so add-user
  -- never touches their sign-in account). Add Staff is unchanged (add_user: admin-managed-separately).
  if system_admin and exists (select 1 from public.profiles p where p.email = p_email and p.deleted_at is not null
      and p.organization_id = public.current_organization_id()
      and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')) then
    raise exception 'This Admin was deleted; reactivate them instead' using errcode = '23514', hint = 'deactivated-admin';
  end if;
  if system_admin and cardinality(p_roles) > 1 then
    raise exception 'An admin cannot have any other role' using errcode = '23514', hint = 'admin-exclusive';
  end if;
  if system_admin then return; end if;
  select d.is_quality into quality from public.departments d
  where d.id = p_department_id and d.organization_id = public.current_organization_id()
    and d.removed_at is null and d.deletion_job_id is null;
  if not found then
    raise exception 'Department is no longer available' using errcode = '23514', hint = 'department-unavailable';
  end if;
  if 'approver' = any (p_roles) and not quality then
    raise exception 'Approver is only allowed in the Quality department' using errcode = '23514', hint = 'approver-quality';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_user(p_user_id uuid, p_email text, p_full_name text, p_phone text, p_position text, p_department_id text, p_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  person public.profiles;
  words text[];
  new_name text := btrim(p_full_name);
  current_roles text[];
  readded boolean;
  saved jsonb;
  system_admin boolean := p_roles is not null and 'admin' = any (p_roles);
  new_department text := case when system_admin then null else p_department_id end;
  new_position text := case when system_admin then null else btrim(p_position) end;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform public.lock_organization_changes(public.current_organization_id());
  -- Again, under the lock, and now no one else can add this email at the same moment.
  perform public.check_new_user(p_email, p_full_name, p_phone, new_position, new_department, p_roles);

  -- The account must be this person's: an admin can't attach a profile to someone else's account.
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.deleted_at is null and lower(u.email) = p_email) then
    raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
  end if;

  select * into person from public.profiles p where p.id = p_user_id for update;
  readded := found;
  -- One account belongs to one organization: a profile in another organization can't be added here.
  if readded and person.organization_id is distinct from public.current_organization_id() then
    raise exception 'A user with this email already exists' using errcode = '23514', hint = 'email-taken';
  end if;
  if readded and person.deleted_at is null then
    raise exception 'A user with this email already exists' using errcode = '23514', hint = 'email-taken';
  end if;

  -- Reactivation: Add Staff never brings back a former Admin (Admins are managed on the Admins page).
  if readded and not system_admin and exists (select 1 from public.user_roles r where r.user_id = person.id and r.role = 'admin') then
    raise exception 'Admins are managed on the Admins page' using errcode = '23514', hint = 'admin-managed-separately';
  end if;
  -- Add Admin never brings back a deleted Admin either: they are reactivated from the Deactivated Admins tab.
  if readded and system_admin and exists (select 1 from public.user_roles r where r.user_id = person.id and r.role = 'admin') then
    raise exception 'This Admin was deleted; reactivate them instead' using errcode = '23514', hint = 'deactivated-admin';
  end if;

  -- Only for this person, only in this transaction (user_roles_guard_admin).
  perform pg_catalog.set_config('hawkim.adding_user', p_user_id::text, true);

  if readded then
    update public.profiles p set deleted_at = null, email = p_email where p.id = person.id;
    select coalesce(array_agg(r.role::text), '{}') into current_roles from public.user_roles r where r.user_id = person.id;
    -- Reactivation: no session from before (or started while deactivated) comes back with the profile.
    delete from auth.sessions s where s.user_id = person.id;
    delete from auth.refresh_tokens t where t.user_id = person.id::text;
  else
    -- Initials as in accept_access_request and update_user_details.
    words := pg_catalog.regexp_split_to_array(new_name, '\s+');
    insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
    values (p_user_id, new_name, p_email, upper(case
        when pg_catalog.array_length(words, 1) >= 2 then left(words[1], 1) || left(words[pg_catalog.array_length(words, 1)], 1)
        else left(words[1], 2)
      end), new_department, p_phone, new_position);
    current_roles := '{}';
  end if;

  -- The same save as Edit Staff: its rules, role order and audit row.
  saved := public.save_user(p_user_id, p_full_name, p_phone, new_position, new_department, p_roles,
    case when readded then person.department_id else new_department end, current_roles);

  perform pg_catalog.set_config('hawkim.adding_user', '', true);

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'add-user', p_user_id::text, jsonb_build_object('readded', readded));
  -- Reactivation: its own audit row, with when the profile had been deactivated.
  if readded then
    insert into public.organization_management_audit (actor_id, action, entity_id, details)
    values ((select auth.uid()), 'reactivate-user', p_user_id::text, jsonb_build_object(
      'email', p_email, 'deactivatedAt', person.deleted_at, 'systemAdmin', system_admin));
  end if;

  return saved || jsonb_build_object('id', p_user_id, 'email', p_email, 'reactivated', readded);
end;
$function$;

create or replace function public.invitation_link_state(p_link_ref uuid) returns text
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

drop function if exists public.invitation_cancelled(uuid);
drop function if exists public.invitation_unactivated(uuid);

alter function public.check_new_user(text, text, text, text, text, text[]) owner to postgres;
alter function public.add_user(uuid, text, text, text, text, text, text[]) owner to postgres;
alter function public.invitation_link_state(uuid) owner to postgres;

notify pgrst, 'reload schema';

commit;
