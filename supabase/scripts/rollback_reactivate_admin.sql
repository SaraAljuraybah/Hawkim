-- Undoes supabase/migrations/20261121120000_admin_reactivation.sql: drops reactivate_admin and puts back
-- delete_admin and add_user exactly as they were in 20261116160000_scope_staff_functions.sql, and check_new_user
-- exactly as it was in 20261117140000_add_user_other_organization.sql. Run as the owner (postgres).
-- Admins reactivated while it was in place stay active (their profile is simply active again).
begin;

drop function if exists public.reactivate_admin(uuid);

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
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'delete-admin', person.id::text, jsonb_build_object('email', person.email));
end;
$function$;

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

alter function public.delete_admin(uuid) owner to postgres;
alter function public.check_new_user(text, text, text, text, text, text[]) owner to postgres;
alter function public.add_user(uuid, text, text, text, text, text, text[]) owner to postgres;

notify pgrst, 'reload schema';
commit;
