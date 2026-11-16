-- Reactivate Admin (the Admins page's Deactivated Admins tab and a deleted Admin's own page).
--
-- 1. reactivate_admin(p_user_id): NEW. The Super Admin brings back a deleted Admin of their own organization
--    (profiles.deleted_at back to null). It is the same person: the profile and sign-in account ids are reused,
--    nothing is created, and their Admin permission (user_roles, which delete_admin never removed) and history
--    are as they were. They sign in again with their existing password (or "Forgot password?"); every session
--    that is left is ended first, so nothing from before comes back. Modeled on reactivate_staff.
--    Super Admin only, checked again under the lock (as delete_admin). Only a profile of the caller's
--    organization with the Admin permission: anything else (staff, another organization's Admin, an unknown
--    id) is "Admin not found" (P0002), the same answer. Refused: someone else now using the email (hint
--    'email-taken'); a sign-in account that was removed or blocked (hint 'account-unavailable'). Reactivating
--    an Admin who is already active changes nothing (alreadyActive: true). A 'reactivate-admin' audit row is added.
--
-- 2. delete_admin: also signs the Admin out everywhere (their sessions and refresh tokens), as deactivate_staff
--    does. Everything else is unchanged.
--
-- 3. check_new_user and add_user: Add Admin with the email of a deleted Admin of this organization is refused
--    (hint 'deactivated-admin': reactivate them from the Deactivated Admins tab instead). check_new_user is
--    what the add-user Edge Function calls first, so the refusal comes before it touches the sign-in account
--    (a deleted Admin's password is never replaced); add_user checks again by the account id, under the lock.
--    Add Staff is unchanged (a deleted Admin's email there is still 'admin-managed-separately').
--
-- Each changed function is its LATEST definition (delete_admin and add_user from
-- 20261116160000_scope_staff_functions.sql, check_new_user from 20261117140000_add_user_other_organization.sql)
-- with only the changes above. CREATE OR REPLACE keeps their owners and grants.
--
-- Undo: supabase/scripts/rollback_reactivate_admin.sql

begin;

-- ---------- 1. Reactivate Admin ----------

create function public.reactivate_admin(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  person public.profiles;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin required' using errcode = '42501', hint = 'super-admin-required';
  end if;
  -- The lock every staff and admin change takes: one change at a time.
  perform public.lock_organization_changes(public.current_organization_id());
  -- Again under the lock (as delete_admin): the caller may have just transferred the role.
  perform 1 from public.organizations o where o.id = public.current_organization_id() for update;
  if not public.is_super_admin() then
    raise exception 'Super Admin required' using errcode = '42501', hint = 'super-admin-required';
  end if;

  select * into person from public.profiles p
  where p.id = p_user_id and p.organization_id = public.current_organization_id() for update;
  -- Staff, another organization's Admin and an unknown id get the same answer.
  if not found or not exists (select 1 from public.user_roles r where r.user_id = person.id and r.role = 'admin') then
    raise exception 'Admin not found' using errcode = 'P0002';
  end if;
  if person.deleted_at is null then
    -- Already active (a repeated or concurrent request): nothing changes.
    return jsonb_build_object('id', person.id, 'alreadyActive', true);
  end if;
  if exists (select 1 from public.profiles p where p.email = person.email and p.deleted_at is null and p.id <> person.id) then
    raise exception 'A user with this email already exists' using errcode = '23514', hint = 'email-taken';
  end if;
  if not exists (select 1 from auth.users u where u.id = person.id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())) then
    raise exception 'The sign-in account is not available' using errcode = '23514', hint = 'account-unavailable';
  end if;

  update public.profiles p set deleted_at = null where p.id = person.id;

  -- No session from before (or started while deleted) comes back with the profile.
  delete from auth.sessions s where s.user_id = person.id;
  delete from auth.refresh_tokens t where t.user_id = person.id::text;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values (caller, 'reactivate-admin', person.id::text, jsonb_build_object('email', person.email, 'deletedAt', person.deleted_at));

  return jsonb_build_object('id', person.id, 'alreadyActive', false);
end;
$$;

-- ---------- 2. delete_admin: also ends their sessions ----------

CREATE OR REPLACE FUNCTION public.delete_admin(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare person public.profiles;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin required' using errcode = '42501', hint = 'super-admin-required';
  end if;
  perform public.lock_organization_changes(public.current_organization_id());
  -- Under the lock: the caller may have just transferred the role.
  perform 1 from public.organizations o where o.id = public.current_organization_id() for update;
  if not public.is_super_admin() then
    raise exception 'Super Admin required' using errcode = '42501', hint = 'super-admin-required';
  end if;
  select * into person from public.profiles p
  where p.id = p_user_id and p.deleted_at is null and p.organization_id = public.current_organization_id() for update;
  if not found or not exists (select 1 from public.user_roles r where r.user_id = person.id and r.role = 'admin') then
    raise exception 'Admin not found' using errcode = 'P0002';
  end if;
  if person.id = public.super_admin_id() then
    raise exception 'The Super Admin can''t be deleted; transfer the role first' using errcode = '23514', hint = 'super-admin-protected';
  end if;
  update public.profiles p set deleted_at = now() where p.id = person.id;
  -- Sign them out everywhere, as deactivate_staff does: their refresh tokens go with their sessions.
  delete from auth.sessions s where s.user_id = person.id;
  delete from auth.refresh_tokens t where t.user_id = person.id::text;
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'delete-admin', person.id::text, jsonb_build_object('email', person.email));
end;
$function$;

-- ---------- 3. Add Admin never brings back a deleted Admin ----------

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

-- ---------- 4. Ownership and grants ----------

alter function public.reactivate_admin(uuid) owner to postgres;
-- CREATE OR REPLACE keeps the owner and grants; set again so they never depend on that.
alter function public.delete_admin(uuid) owner to postgres;
alter function public.check_new_user(text, text, text, text, text, text[]) owner to postgres;
alter function public.add_user(uuid, text, text, text, text, text, text[]) owner to postgres;

revoke all on function public.reactivate_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reactivate_admin(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
