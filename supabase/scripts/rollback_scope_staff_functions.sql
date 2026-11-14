-- Undoes supabase/migrations/20261116160000_scope_staff_functions.sql: the functions as they were before it
-- (pg_get_functiondef). Run as the owner (postgres). Only safe while MedCare is the only organization.
begin;

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
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  -- Again, under the lock, and now no one else can add this email at the same moment.
  perform public.check_new_user(p_email, p_full_name, p_phone, new_position, new_department, p_roles);

  -- The account must be this person's: an admin can't attach a profile to someone else's account.
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.deleted_at is null and lower(u.email) = p_email) then
    raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
  end if;

  select * into person from public.profiles p where p.id = p_user_id for update;
  readded := found;
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
$function$

;

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
  if system_admin and cardinality(p_roles) > 1 then
    raise exception 'An admin cannot have any other role' using errcode = '23514', hint = 'admin-exclusive';
  end if;
  if system_admin then return; end if;
  select d.is_quality into quality from public.departments d
  where d.id = p_department_id and d.removed_at is null and d.deletion_job_id is null;
  if not found then
    raise exception 'Department is no longer available' using errcode = '23514', hint = 'department-unavailable';
  end if;
  if 'approver' = any (p_roles) and not quality then
    raise exception 'Approver is only allowed in the Quality department' using errcode = '23514', hint = 'approver-quality';
  end if;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.save_user(p_user_id uuid, p_full_name text, p_phone text, p_position text, p_department_id text, p_roles text[], p_expected_department_id text, p_expected_roles text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  person public.profiles;
  current_roles text[];
  new_roles text[];
  expected_roles text[];
  removed_roles text[];
  quality boolean;
  in_use text[] := '{}';
  used integer;
  removed_positions text[] := '{}';
  saved jsonb;
  system_admin boolean;
  new_department text;
  new_name text := btrim(p_full_name);
  new_initials text;
  words text[];
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  -- Again, under the lock: another admin may have just removed this caller's Admin.
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  select * into person from public.profiles p where p.id = p_user_id
    and (p.deleted_at is null or not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')) for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(r.role::text order by r.role::text), '{}') into current_roles
  from public.user_roles r where r.user_id = person.id;
  select coalesce(array_agg(distinct x order by x), '{}') into new_roles from unnest(p_roles) x;
  select coalesce(array_agg(distinct x order by x), '{}') into expected_roles from unnest(p_expected_roles) x;
  system_admin := 'admin' = any (new_roles);
  new_department := case when system_admin then person.department_id else p_department_id end;

  if p_roles is null or (not system_admin and p_department_id is null) or not new_roles <@ array['author', 'reviewer', 'approver', 'admin'] then
    raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
  end if;
  if person.department_id is distinct from p_expected_department_id or current_roles <> expected_roles then
    -- Not 40001: PostgREST 14 retries SQLSTATE 40001 until it times out.
    raise exception 'User changed; refresh and try again' using errcode = 'P0001', hint = 'conflict';
  end if;

  select coalesce(array_agg(x), '{}') into removed_roles from unnest(current_roles) x where x <> all (new_roles);

  if 'admin' = any (removed_roles) then
    if person.id = (select auth.uid()) then
      raise exception 'You can''t remove your own Admin permission' using errcode = '23514', hint = 'self-admin';
    end if;
    if not exists (
      select 1 from public.user_roles r
      join public.profiles p on p.id = r.user_id and p.deleted_at is null
      join auth.users u on u.id = p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
      where r.role = 'admin' and r.user_id <> person.id
    ) then
      raise exception 'Hawkim must always have an admin' using errcode = '23514', hint = 'last-admin';
    end if;
  end if;

  -- Deactivated staff: details and permissions can be edited, but never into an Admin.
  if system_admin and person.deleted_at is not null then
    raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
  end if;

  if system_admin and cardinality(new_roles) > 1 then
    raise exception 'An admin cannot have any other role' using errcode = '23514', hint = 'admin-exclusive';
  end if;

  if not system_admin then
    select d.is_quality into quality from public.departments d
    where d.id = p_department_id and d.removed_at is null and d.deletion_job_id is null;
    if not found then
      raise exception 'Department is no longer available' using errcode = '23514', hint = 'department-unavailable';
    end if;
    if 'approver' = any (new_roles) and not quality then
      raise exception 'Approver is only allowed in the Quality department' using errcode = '23514', hint = 'approver-quality';
    end if;
  end if;

  -- Permissions in use (as before).
  if 'author' = any (removed_roles) then
    select count(*) into used from public.sops s
    where s.deleted_at is null and s.status <> 'published'
      and (s.author_id = person.id or public.is_co_author(s.id, person.id));
    if used > 0 then in_use := in_use || ('author:' || used); end if;
  end if;
  if 'reviewer' = any (removed_roles) then
    select count(*) into used from public.sops s
    where s.deleted_at is null and s.status in ('in-review', 'in-approval', 'returned', 'approved')
      and (
        select q.status from public.review_requests q
        where q.sop_id = s.id and q.reviewer_id = person.id
          and q.round_id = (select r.id from public.review_rounds r where r.sop_id = s.id order by r.requested_at desc, r.id desc limit 1)
        order by q.seq desc limit 1
      ) in ('pending', 'accepted', 'completed', 'returned');
    if used > 0 then in_use := in_use || ('reviewer:' || used); end if;
  end if;
  if cardinality(in_use) > 0 then
    raise exception 'Permission in use' using errcode = '23514', hint = 'permission-in-use', detail = array_to_string(in_use, ',');
  end if;

  -- Department transfer restriction, checked with the roles they hold now (before any change below).
  if new_department is distinct from person.department_id and person.department_id is not null then
    perform public.assert_department_transfer_allowed(person.id);
  end if;

  if system_admin then
    -- Name and phone only, with the same rules as update_user_details.
    if new_name is null or char_length(new_name) not between 1 and 100 or p_phone is null or p_phone !~ '^\+9665[0-9]{8}$' then
      raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
    end if;
    new_initials := person.initials;
    if new_name is distinct from person.full_name then
      words := pg_catalog.regexp_split_to_array(new_name, '\s+');
      new_initials := upper(case
        when pg_catalog.array_length(words, 1) >= 2 then left(words[1], 1) || left(words[pg_catalog.array_length(words, 1)], 1)
        else left(words[1], 2)
      end);
    end if;
    update public.profiles p set full_name = new_name, initials = new_initials, phone = p_phone where p.id = person.id;
    saved := jsonb_build_object('name', new_name, 'initials', new_initials, 'phone', p_phone, 'position', person."position");
  else
    saved := public.update_user_details(person.id, p_full_name, p_phone, p_position);
  end if;

  -- Removed first and added last: the role triggers read the department and the other roles.
  delete from public.user_roles ur where ur.user_id = person.id and ur.role::text = any (removed_roles);

  if new_department is distinct from person.department_id then
    select coalesce(array_agg(e.title order by e.sort_order, e.title), '{}') into removed_positions
    from public.employee_positions e where e.profile_id = person.id and e.department_id = person.department_id;
    -- Refused by profiles_department_transfer_guard while SOP work is in progress.
    update public.profiles p set department_id = new_department where p.id = person.id;
  end if;

  insert into public.user_roles (user_id, role)
  select person.id, x::public.app_role from unnest(new_roles) x where x <> all (current_roles);

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'save-user', person.id::text, jsonb_build_object(
    'departmentBefore', person.department_id, 'departmentAfter', new_department,
    'rolesBefore', to_jsonb(current_roles), 'rolesAfter', to_jsonb(new_roles),
    'positionsInOldDepartment', to_jsonb(removed_positions)
  ));

  return saved || jsonb_build_object('departmentId', new_department, 'permissions', to_jsonb(new_roles));
end;
$function$

;

CREATE OR REPLACE FUNCTION public.update_user_details(p_user_id uuid, p_full_name text, p_phone text, p_position text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  person public.profiles;
  new_name text := btrim(p_full_name);
  new_position text := btrim(p_position);
  new_initials text;
  words text[];
  changed text[];
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if new_name is null or char_length(new_name) not between 1 and 100
    or p_phone is null or p_phone !~ '^\+9665[0-9]{8}$'
    or new_position is null or char_length(new_position) not between 1 and 100 then
    raise exception 'Invalid user details' using errcode = '23514';
  end if;

  -- The same lock as the other organization changes, including set_employee_positions.
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into person from public.profiles p where p.id = p_user_id
    and (p.deleted_at is null or not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')) for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  -- Initials only follow a new name, worked out as in accept_access_request.
  new_initials := person.initials;
  if new_name is distinct from person.full_name then
    words := pg_catalog.regexp_split_to_array(new_name, '\s+');
    new_initials := upper(case
      when pg_catalog.array_length(words, 1) >= 2 then left(words[1], 1) || left(words[pg_catalog.array_length(words, 1)], 1)
      else left(words[1], 2)
    end);
  end if;

  changed := pg_catalog.array_remove(array[
    case when new_name is distinct from person.full_name then 'name' end,
    case when p_phone is distinct from person.phone then 'phone' end,
    case when new_position is distinct from person."position" then 'position' end
  ], null);

  update public.profiles p
  set full_name = new_name, initials = new_initials, phone = p_phone
  where p.id = person.id;

  -- Separate, because naming position in an update runs the positions trigger even when it's unchanged.
  if new_position is distinct from person."position" then
    update public.profiles p set "position" = new_position where p.id = person.id;
  end if;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'update-user-details', person.id::text, jsonb_build_object('fields', to_jsonb(changed)));

  return jsonb_build_object('name', new_name, 'initials', new_initials, 'phone', p_phone, 'position', new_position);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.set_user_email(p_user_id uuid, p_email text, p_apply boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare person public.profiles;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_email is null or p_email <> lower(btrim(p_email)) or char_length(p_email) > 254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into person from public.profiles p where p.id = p_user_id
    and (p.deleted_at is null or not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')) for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  perform public.assert_can_change_person(person.id);
  if exists (select 1 from public.profiles p where p.email = p_email and p.deleted_at is null and p.id <> person.id) then
    raise exception 'A user with this email already exists' using errcode = '23514', hint = 'email-taken';
  end if;
  if not coalesce(p_apply, false) then return null; end if;
  if not exists (select 1 from auth.users u where u.id = person.id and lower(u.email) = p_email) then
    raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
  end if;
  update public.profiles p set email = p_email where p.id = person.id;
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'set-user-email', person.id::text, jsonb_build_object('changed', p_email is distinct from person.email));
  return p_email;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.deactivate_staff(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller uuid := (select auth.uid());
  person public.profiles;
  summary jsonb;
  ended_at timestamptz := now();
  ended_sessions integer;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  -- The lock every staff and admin change takes: one change at a time.
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  -- Again under the lock: the caller may have just been deleted as an Admin.
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  -- Holding the row also makes new SOP assignments for this person wait (lock_sop_assignee), so the
  -- count below sees every assignment committed before it.
  select * into person from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if person.id = caller then
    raise exception 'You can''t deactivate your own account' using errcode = '23514', hint = 'self-delete';
  end if;
  if exists (select 1 from public.user_roles r where r.user_id = person.id and r.role = 'admin') then
    raise exception 'Admins are managed on the Admins page' using errcode = '23514', hint = 'admin-managed-separately';
  end if;
  if person.deleted_at is not null then
    -- Already deactivated (a repeated or concurrent request): nothing changes.
    return jsonb_build_object('id', person.id, 'deactivatedAt', person.deleted_at, 'alreadyDeactivated', true);
  end if;
  summary := public.sop_responsibilities_in_progress(person.id);
  if (summary->>'total')::integer > 0 then
    raise exception 'Deactivation not allowed: SOP responsibilities in progress'
      using errcode = '23514', hint = 'responsibilities-in-progress',
        detail = concat_ws(',', 'total:' || (summary->>'total'),
          'author:' || (summary->>'author'), 'co-author:' || (summary->>'co-author'),
          'reviewer:' || (summary->>'reviewer'), 'approver:' || (summary->>'approver'));
  end if;

  update public.profiles p set deleted_at = ended_at where p.id = person.id;

  -- Sign them out everywhere: their refresh tokens go with their sessions (on delete cascade).
  with ended as (delete from auth.sessions s where s.user_id = person.id returning 1)
  select count(*) into ended_sessions from ended;
  delete from auth.refresh_tokens t where t.user_id = person.id::text;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values (caller, 'deactivate-staff', person.id::text, jsonb_build_object('email', person.email, 'endedSessions', ended_sessions));

  return jsonb_build_object('id', person.id, 'deactivatedAt', ended_at, 'alreadyDeactivated', false);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.reactivate_staff(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller uuid := (select auth.uid());
  person public.profiles;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  -- The lock every staff and admin change takes: one change at a time.
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  -- Again under the lock: the caller may have just been deleted as an Admin.
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  select * into person from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.user_roles r where r.user_id = person.id and r.role = 'admin') then
    raise exception 'Admins are managed on the Admins page' using errcode = '23514', hint = 'admin-managed-separately';
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
  if person.department_id is null or not exists (select 1 from public.departments d
      where d.id = person.department_id and d.removed_at is null and d.deletion_job_id is null for share) then
    raise exception 'Department is no longer available' using errcode = '23514', hint = 'department-unavailable';
  end if;

  update public.profiles p set deleted_at = null where p.id = person.id;

  -- No session from before (or started while deactivated) comes back with the profile.
  delete from auth.sessions s where s.user_id = person.id;
  delete from auth.refresh_tokens t where t.user_id = person.id::text;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values (caller, 'reactivate-user', person.id::text, jsonb_build_object(
    'email', person.email, 'deactivatedAt', person.deleted_at, 'source', 'reactivate-staff'));

  return jsonb_build_object('id', person.id, 'alreadyActive', false);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.set_employee_positions(p_profile_id uuid, p_titles text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare person public.profiles; titles text[]; i integer;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode = '42501'; end if;
  select array_agg(t order by n) into titles from (
    select distinct on (lower(btrim(t))) btrim(t) as t, n
    from unnest(coalesce(p_titles, '{}')) with ordinality as x(t, n)
    where btrim(coalesce(t, '')) <> '' order by lower(btrim(t)), n
  ) cleaned;
  if titles is null or cardinality(titles) = 0 then
    raise exception 'A position is required for a department assignment' using errcode = '23514';
  end if;
  if cardinality(titles) > 10 or exists (select 1 from unnest(titles) t where char_length(t) > 100) then
    raise exception 'Invalid position fields' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into person from public.profiles where id = p_profile_id and deleted_at is null for update;
  if not found or person.department_id is null then
    raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict';
  end if;
  if exists (select 1 from public.departments d where d.id = person.department_id and (d.removed_at is not null or d.deletion_job_id is not null)) then
    raise exception 'Department is no longer available' using errcode = '23514';
  end if;
  perform pg_catalog.set_config('hawkim.positions_managed', 'on', true);
  delete from public.employee_positions where profile_id = person.id;
  for i in 1 .. cardinality(titles) loop
    insert into public.employee_positions(profile_id, department_id, title, sort_order)
    values (person.id, person.department_id, titles[i], i - 1);
  end loop;
  update public.profiles set position = titles[1] where id = person.id and position is distinct from titles[1];
  perform pg_catalog.set_config('hawkim.positions_managed', 'off', true);
  insert into public.organization_management_audit(actor_id, action, entity_id, details)
  values (auth.uid(), 'set-employee-positions', person.id::text,
    jsonb_build_object('departmentId', person.department_id, 'positions', to_jsonb(titles)));
end; $function$

;

CREATE OR REPLACE FUNCTION public.update_admin(p_user_id uuid, p_full_name text, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  person public.profiles;
  new_name text := btrim(p_full_name);
  new_initials text;
  words text[];
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into person from public.profiles p where p.id = p_user_id and p.deleted_at is null for update;
  if not found or not exists (select 1 from public.user_roles r where r.user_id = person.id and r.role = 'admin') then
    raise exception 'Admin not found' using errcode = 'P0002';
  end if;
  perform public.assert_can_change_person(person.id);
  if new_name is null or char_length(new_name) not between 1 and 100 or p_phone is null or p_phone !~ '^\+9665[0-9]{8}$' then
    raise exception 'Invalid admin details' using errcode = '23514', hint = 'invalid';
  end if;
  new_initials := person.initials;
  if new_name is distinct from person.full_name then
    -- Initials as in add_user and save_user.
    words := pg_catalog.regexp_split_to_array(new_name, '\s+');
    new_initials := upper(case
      when pg_catalog.array_length(words, 1) >= 2 then left(words[1], 1) || left(words[pg_catalog.array_length(words, 1)], 1)
      else left(words[1], 2)
    end);
  end if;
  update public.profiles p set full_name = new_name, initials = new_initials, phone = p_phone where p.id = person.id;
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'update-admin', person.id::text, jsonb_build_object(
    'nameChanged', new_name is distinct from person.full_name, 'phoneChanged', p_phone is distinct from person.phone));
  return jsonb_build_object('id', person.id, 'name', new_name, 'initials', new_initials, 'phone', p_phone);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.record_invitation_sent(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.claim_invitation_resend(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.revert_invitation_resend(p_user_id uuid, p_claimed_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501', hint = 'forbidden';
  end if;
  update public.user_invitations i
  set sent_at = i.previous_sent_at, sent_by = i.previous_sent_by, previous_sent_at = null, previous_sent_by = null
  where i.user_id = p_user_id and i.sent_at = p_claimed_at and i.previous_sent_at is not null;
  return found;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.get_my_expired_invitations()
 RETURNS TABLE(user_id uuid, name text, email text, kind text, sent_at timestamp with time zone, expired_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.lock_sop_approvers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform 1 from public.profiles p
  where p.deleted_at is null and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'approver')
  order by p.id
  for share of p;
  return new;
end; $function$

;

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
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
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
$function$

;

CREATE OR REPLACE FUNCTION public.transfer_super_admin(p_recipient uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  org public.organizations;
  caller uuid := (select auth.uid());
begin
  if not public.can_manage_organization() then
    raise exception 'Super Admin required' using errcode = '42501', hint = 'super-admin-required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into org from public.organizations o where o.id = public.current_organization_id() for update;
  -- Checked under the lock: a repeated or concurrent request finds the role already moved.
  if not found or org.super_admin_id is distinct from caller or not public.can_manage_organization() then
    raise exception 'Super Admin required' using errcode = '42501', hint = 'super-admin-required';
  end if;
  if p_recipient is null or p_recipient = caller then
    raise exception 'Choose another Admin' using errcode = '23514', hint = 'recipient-self';
  end if;
  perform 1 from public.profiles p where p.id = p_recipient for update;
  if not public.is_active_admin(p_recipient)
    or not exists (select 1 from public.profiles p where p.id = p_recipient and p.organization_id = org.id) then
    raise exception 'The new Super Admin must be an active Admin' using errcode = '23514', hint = 'recipient-not-admin';
  end if;
  update public.organizations o set super_admin_id = p_recipient, super_admin_assigned_at = now() where o.id = org.id;
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values (caller, 'transfer-super-admin', p_recipient::text, jsonb_build_object(
    'previousSuperAdminId', caller, 'newSuperAdminId', p_recipient,
    'before', jsonb_build_object(caller::text, 'super-admin', p_recipient::text, 'admin'),
    'after', jsonb_build_object(caller::text, 'admin', p_recipient::text, 'super-admin')));
  return p_recipient;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.assign_initial_super_admin(p_organization_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare org public.organizations;
begin
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into org from public.organizations o where o.id = p_organization_id for update;
  if not found then
    raise exception 'No such organization' using errcode = 'P0002';
  end if;
  if org.super_admin_id is not null then
    raise exception 'A Super Admin is already assigned; use the transfer' using errcode = '23514';
  end if;
  update public.organizations o set super_admin_id = p_user_id, super_admin_assigned_at = now() where o.id = org.id;
end;
$function$

;

drop function public.lock_organization_changes(uuid);

notify pgrst, 'reload schema';
commit;
