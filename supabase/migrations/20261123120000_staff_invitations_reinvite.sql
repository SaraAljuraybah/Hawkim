-- Sent Invitations, part 2: re-inviting a cancelled staff member, and only activated staff for new assignments.
--
-- Builds on 20261122120000_staff_invitations.sql. Additive: people without an invitation record are unchanged.
--
-- 1. Backfill (one time): an invitation whose person signed in after it was sent counts as activated (they set a
--    password; before 20261122120000 the app never waited for that to be recorded). Audited.
-- 2. Re-invite: Add Staff with the email of a staff member whose invitation was cancelled reuses their account and
--    profile (check_new_user no longer calls it taken; add_user saves the details entered, ends their sessions and
--    returns reinvited = true). The add-user Edge Function then unblocks the account in Auth with a password nobody
--    knows (every earlier link stays dead), emails a new link and records it (record_invitation_sent clears the
--    cancellation). Until they accept it, they are on Sent Invitations, not Active Staff.
--    is_invitation_cancelled: for that Edge Function, as the calling Admin.
-- 3. invitation_link_state: a link issued before a cancellation stays "cancelled" after a re-invite.
-- 4. Eligibility: get_unactivated_people lists, for any active user of the organization, the people whose tracked
--    invitation isn't activated (waiting, expired or cancelled): the app leaves them out of every people picker.
--    Triggers refuse them as new reviewers (review_requests) and co-authors (sop_co_authors), whatever the caller.
--    Existing rows (history, earlier assignments) are never touched.
--
-- Rollback: supabase/scripts/rollback_staff_invitations_reinvite.sql.

begin;

-- ---------- Helpers ----------

-- The person's tracked invitation exists and isn't activated (waiting, expired or cancelled).
create function public.invitation_unactivated(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_invitations i where i.user_id = p_user_id and public.invitation_pending(i))
$$;

-- The person's invitation was cancelled (and not sent again since).
create function public.invitation_cancelled(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_invitations i where i.user_id = p_user_id and i.cancelled_at is not null)
$$;

-- ---------- 1. Backfill ----------

with backfilled as (
  update public.user_invitations i set activated_at = u.last_sign_in_at
  from auth.users u
  where u.id = i.user_id and i.cancelled_at is null and public.invitation_pending(i) and u.last_sign_in_at > i.sent_at
  returning i.user_id
)
insert into public.organization_management_audit (actor_id, action, entity_id, details)
select b.user_id, 'invitation-activated', b.user_id::text, jsonb_build_object('backfilled', true)
from backfilled b;

-- ---------- 2. Re-invite ----------

-- For the add-user Edge Function, as the calling Admin: a staff member of the caller's organization whose
-- invitation was cancelled (Add Staff then re-invites them instead of calling the email taken).
create function public.is_invitation_cancelled(p_user_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  return exists (select 1 from public.profiles p where p.id = p_user_id and p.organization_id = public.current_organization_id()
      and p.deleted_at is null)
    and not exists (select 1 from public.user_roles r where r.user_id = p_user_id and r.role = 'admin')
    and public.invitation_cancelled(p_user_id);
end;
$$;

-- As 20261121120000, except that a staff member of this organization whose invitation was cancelled isn't
-- "taken" for Add Staff (they are re-invited).
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
  if exists (select 1 from public.profiles p where p.email = p_email and p.deleted_at is null
      and not (not system_admin and p.organization_id = public.current_organization_id() and public.invitation_cancelled(p.id)
               and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin'))) then
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

-- As 20261121120000, plus the re-invite of a staff member whose invitation was cancelled: the same account and
-- profile, with the details entered, their sessions ended, audited as reinvite-user, and `reinvited` returned.
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
  reinvite boolean := false;
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
  -- Re-invite: an active staff member whose invitation was cancelled (never an Admin, never by Add Admin).
  reinvite := readded and person.deleted_at is null and not system_admin and public.invitation_cancelled(person.id)
    and not exists (select 1 from public.user_roles r where r.user_id = person.id and r.role = 'admin');
  if readded and person.deleted_at is null and not reinvite then
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
    -- Reactivation and re-invite: no session from before comes back.
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
  if reinvite then
    insert into public.organization_management_audit (actor_id, action, entity_id, details)
    values ((select auth.uid()), 'reinvite-user', p_user_id::text, jsonb_build_object('email', p_email));
  elsif readded then
    -- Reactivation: its own audit row, with when the profile had been deactivated.
    insert into public.organization_management_audit (actor_id, action, entity_id, details)
    values ((select auth.uid()), 'reactivate-user', p_user_id::text, jsonb_build_object(
      'email', p_email, 'deactivatedAt', person.deleted_at, 'systemAdmin', system_admin));
  end if;

  return saved || jsonb_build_object('id', p_user_id, 'email', p_email, 'reactivated', readded and not reinvite, 'reinvited', reinvite);
end;
$function$;

-- ---------- 3. A link issued before a cancellation stays "cancelled" ----------

create or replace function public.invitation_link_state(p_link_ref uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  invitation public.user_invitations;
  person uuid;
  issued bigint;
begin
  if p_link_ref is null then
    return 'unknown';
  end if;
  -- The sending (or resending) that made this link.
  select a.entity_id::uuid, a.id into person, issued from public.organization_management_audit a
  where a.action in ('invitation-sent', 'invitation-resent') and a.details ->> 'linkRef' = p_link_ref::text
  order by a.id desc limit 1;
  if person is null then
    select i.user_id into person from public.user_invitations i where i.link_ref = p_link_ref;
    if person is null then
      return 'unknown';
    end if;
  end if;
  select * into invitation from public.user_invitations i where i.user_id = person;
  if not found or not exists (select 1 from public.profiles p where p.id = person and p.deleted_at is null) then
    return 'unknown';
  end if;
  if invitation.cancelled_at is not null then
    return 'cancelled';
  end if;
  -- Cancelled since this link was sent (and not undone), even if the person was invited again afterwards.
  if issued is not null and (select count(*) from public.organization_management_audit a
      where a.entity_id = person::text and a.action = 'invitation-cancelled' and a.id > issued)
    > (select count(*) from public.organization_management_audit a
      where a.entity_id = person::text and a.action = 'invitation-cancel-undone' and a.id > issued) then
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

-- ---------- 4. Only activated staff for new assignments ----------

-- Any active user of the organization: the people whose tracked invitation isn't activated (left out of the
-- people pickers). `cancelled`: the invitation was cancelled (Add Staff may invite them again).
create function public.get_unactivated_people()
returns table (user_id uuid, cancelled boolean)
language sql stable security definer set search_path = '' as $$
  select i.user_id, i.cancelled_at is not null
  from public.user_invitations i
  join public.profiles p on p.id = i.user_id and p.deleted_at is null
  where public.is_active_user()
    and i.organization_id = public.current_organization_id()
    and public.invitation_pending(i)
  order by i.user_id
$$;

-- New reviewers and co-authors must have activated their account (people without an invitation record do).
-- The trigger's argument names the person's column (reviewer_id, user_id). Named zz_ so it runs after the
-- tables' own checks, and only for a person of the row's organization: anyone else is refused by those checks
-- exactly as an unknown id (nothing is told about another organization's people).
create function public.guard_activated_assignee() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := pg_catalog.to_jsonb(new);
  person uuid := (row_data ->> tg_argv[0])::uuid;
begin
  if public.invitation_unactivated(person) and exists (select 1 from public.profiles p where p.id = person
      and p.organization_id = (row_data ->> 'organization_id')::uuid) then
    raise exception 'This person hasn''t activated their account yet' using errcode = '23514', hint = 'person-not-activated';
  end if;
  return new;
end;
$$;

create trigger zz_review_requests_activated_reviewer before insert on public.review_requests
for each row execute function public.guard_activated_assignee('reviewer_id');
create trigger zz_sop_co_authors_activated_co_author before insert on public.sop_co_authors
for each row execute function public.guard_activated_assignee('user_id');

-- ---------- Ownership and grants ----------

alter function public.invitation_unactivated(uuid) owner to postgres;
alter function public.invitation_cancelled(uuid) owner to postgres;
alter function public.is_invitation_cancelled(uuid) owner to postgres;
alter function public.check_new_user(text, text, text, text, text, text[]) owner to postgres;
alter function public.add_user(uuid, text, text, text, text, text, text[]) owner to postgres;
alter function public.invitation_link_state(uuid) owner to postgres;
alter function public.get_unactivated_people() owner to postgres;
alter function public.guard_activated_assignee() owner to postgres;

revoke all on function public.invitation_unactivated(uuid), public.invitation_cancelled(uuid), public.is_invitation_cancelled(uuid),
  public.get_unactivated_people(), public.guard_activated_assignee()
  from public, anon, authenticated, service_role;
grant execute on function public.is_invitation_cancelled(uuid), public.get_unactivated_people() to authenticated;

notify pgrst, 'reload schema';

commit;
