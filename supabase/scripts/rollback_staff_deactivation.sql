-- Rollback of 20261112120000_staff_deactivation.sql (only if it must be undone after being applied).
-- Restores add_user exactly as 20261111120000_super_admin.sql defines it, save_user exactly as
-- 20261110120000_staff_management.sql defines it, and removes deactivate_staff.
-- Nothing else changes, and no data is touched: staff deactivated meanwhile stay deactivated
-- (profiles.deleted_at), and Add Staff can still bring them back, as before this migration.
-- Run as the owner (postgres), in one transaction.
begin;

drop function if exists public.deactivate_staff(uuid);

create or replace function public.add_user(
  p_user_id uuid, p_email text, p_full_name text, p_phone text, p_position text, p_department_id text, p_roles text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Only for this person, only in this transaction (user_roles_guard_admin).
  perform pg_catalog.set_config('hawkim.adding_user', p_user_id::text, true);

  if readded then
    update public.profiles p set deleted_at = null, email = p_email where p.id = person.id;
    select coalesce(array_agg(r.role::text), '{}') into current_roles from public.user_roles r where r.user_id = person.id;
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

  return saved || jsonb_build_object('id', p_user_id, 'email', p_email);
end;
$$;

alter function public.add_user(uuid, text, text, text, text, text, text[]) owner to postgres;

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

  select * into person from public.profiles p where p.id = p_user_id and p.deleted_at is null for update;
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
    raise exception 'User changed; refresh and try again' using errcode = '40001';
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

alter function public.save_user(uuid, text, text, text, text, text[], text, text[]) owner to postgres;

commit;
