-- Feature 2 of connecting the admin portal: an admin saves a user's name, phone, position,
-- department and permissions together: all of it or none of it. The division follows the department.
--
-- Additive: adds one function and changes no table, column, trigger, existing function or existing
-- row. Removing a permission deletes that user_roles row when an admin saves, not when this applies.
--
-- Changing department runs the existing trigger profiles_sync_positions, which removes the user's
-- positions in the old department; their titles are kept in the audit row.
-- Undo: supabase/scripts/rollback_save_user.sql

begin;

create function public.save_user(
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

  if p_roles is null or p_department_id is null or not new_roles <@ array['author', 'reviewer', 'approver', 'admin'] then
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

  if 'admin' = any (new_roles) and cardinality(new_roles) > 1 then
    raise exception 'An admin cannot have any other role' using errcode = '23514', hint = 'admin-exclusive';
  end if;

  select d.is_quality into quality from public.departments d
  where d.id = p_department_id and d.removed_at is null and d.deletion_job_id is null;
  if not found then
    raise exception 'Department is no longer available' using errcode = '23514', hint = 'department-unavailable';
  end if;
  if 'approver' = any (new_roles) and not quality then
    raise exception 'Approver is only allowed in the Quality department' using errcode = '23514', hint = 'approver-quality';
  end if;

  -- Permissions in use. Approver assignments aren't in the database yet, so they aren't checked here.
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

  saved := public.update_user_details(person.id, p_full_name, p_phone, p_position);

  -- Removed first and added last: the role triggers read the department and the other roles.
  delete from public.user_roles ur where ur.user_id = person.id and ur.role::text = any (removed_roles);

  if p_department_id is distinct from person.department_id then
    select coalesce(array_agg(e.title order by e.sort_order, e.title), '{}') into removed_positions
    from public.employee_positions e where e.profile_id = person.id and e.department_id = person.department_id;
    update public.profiles p set department_id = p_department_id where p.id = person.id;
  end if;

  insert into public.user_roles (user_id, role)
  select person.id, x::public.app_role from unnest(new_roles) x where x <> all (current_roles);

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'save-user', person.id::text, jsonb_build_object(
    'departmentBefore', person.department_id, 'departmentAfter', p_department_id,
    'rolesBefore', to_jsonb(current_roles), 'rolesAfter', to_jsonb(new_roles),
    'positionsInOldDepartment', to_jsonb(removed_positions)
  ));

  return saved || jsonb_build_object('departmentId', p_department_id, 'permissions', to_jsonb(new_roles));
end;
$$;

alter function public.save_user(uuid, text, text, text, text, text[], text, text[]) owner to postgres;
revoke all on function public.save_user(uuid, text, text, text, text, text[], text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.save_user(uuid, text, text, text, text, text[], text, text[]) to authenticated;

notify pgrst, 'reload schema';
commit;
