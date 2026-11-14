-- Staff reactivation (Reactivate on the Staff page's Deactive Staff tab), and editing deactivated staff.
--
-- 1. reactivate_staff(p_user_id): an active Admin (or the Super Admin) brings back a deactivated STAFF
--    member (profiles.deleted_at back to null). It is the same person: the profile and sign-in account
--    ids are reused, nothing is created, and nothing else changes. Their permissions (user_roles, which
--    deactivate_staff never removed), department, position, SOPs, reviews and history are as they were,
--    so their permissions are restored as they were assigned. They sign in again with their existing password
--    (or "Forgot password?"); every session that is left is ended first, as Add Staff's reactivation
--    does, so nothing from before comes back. SOP and review work is not reassigned or restored.
--    Refused: anyone but an active Admin; an Admin's profile (hint 'admin-managed-separately', Admins
--    are managed on the Admins page); someone else now using the email (hint 'email-taken'); a sign-in
--    account that was removed or blocked (hint 'account-unavailable'); a department that was removed
--    or is being removed (hint 'department-unavailable': edit their department first, then reactivate).
--    Reactivating someone who is already active changes nothing (alreadyActive: true).
--    A 'reactivate-user' audit row is added (as with Add Staff), with source 'reactivate-staff'.
--
-- 2. save_user, update_user_details and set_user_email (Edit Staff): as before, but they also find a
--    deactivated STAFF member, so their details, department and permissions can be edited while they
--    stay deactivated (saving never reactivates them). A deactivated Admin is still never found, and a
--    deactivated staff member can't be made an Admin here. Every other rule is unchanged.
--
-- 3. guard_employee_position: a position must still be in the employee's home department, but the employee
--    no longer has to be active, so a deactivated staff member's position can be edited.
--
-- Unchanged: deactivate_staff, add_user, delete_admin, the policies.

begin;

-- ---------- 1. Reactivate Staff ----------

create function public.reactivate_staff(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------- 2. Edit Staff finds deactivated staff too ----------

-- As in 20261112120000_staff_deactivation.sql, except the profile lookup and the "never into an Admin" check.
create or replace function public.save_user(
  p_user_id uuid, p_full_name text, p_phone text, p_position text, p_department_id text, p_roles text[],
  p_expected_department_id text, p_expected_roles text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- As in 20261107130000_update_user_details.sql, except the profile lookup.
create or replace function public.update_user_details(p_user_id uuid, p_full_name text, p_phone text, p_position text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- As in 20261111120000_super_admin.sql, except the profile lookup.
create or replace function public.set_user_email(p_user_id uuid, p_email text, p_apply boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ---------- 3. Positions of deactivated staff can be edited too ----------

-- As in 20261107120300_employee_positions.sql, except that the employee no longer has to be active: a
-- position still belongs to their current home department. Deactivation already keeps their position rows;
-- without this, Edit Staff couldn't change a deactivated staff member's position. Admin RPCs remain the only
-- writers (no grants), and assert_employee_has_position still only applies to active employees.
create or replace function public.guard_employee_position() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.profile_id
      and p.department_id = new.department_id) then
    raise exception 'Positions must belong to the employee''s department' using errcode = '23514';
  end if;
  return new;
end; $$;

-- ---------- 4. Ownership and grants ----------

alter function public.reactivate_staff(uuid) owner to postgres;
-- CREATE OR REPLACE keeps the owner and grants; set again so they never depend on that.
alter function public.save_user(uuid, text, text, text, text, text[], text, text[]) owner to postgres;
alter function public.update_user_details(uuid, text, text, text) owner to postgres;
alter function public.set_user_email(uuid, text, boolean) owner to postgres;
alter function public.guard_employee_position() owner to postgres;

revoke all on function public.reactivate_staff(uuid) from public, anon, authenticated, service_role;
grant execute on function public.reactivate_staff(uuid) to authenticated;

commit;
