-- Feature 3 of connecting the admin portal: Add User creates a real account. The add-user Edge
-- Function creates the sign-in account and sends the invitation; these functions save the rest.
--
-- Additive: adds two functions and changes no table, column, trigger, existing function or existing
-- row. A re-added user's old roles are replaced through save_user when an admin saves.
-- Undo: supabase/scripts/rollback_add_user.sql

begin;

-- Every rule for a new user, read-only: run before an account is created.
create function public.check_new_user(
  p_email text, p_full_name text, p_phone text, p_position text, p_department_id text, p_roles text[]
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  quality boolean;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_email is null or p_email <> lower(btrim(p_email)) or char_length(p_email) > 254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or char_length(btrim(coalesce(p_full_name, ''))) not between 1 and 100
    or p_phone is null or p_phone !~ '^\+9665[0-9]{8}$'
    or char_length(btrim(coalesce(p_position, ''))) not between 1 and 100
    or p_department_id is null or p_roles is null
    or not p_roles <@ array['author', 'reviewer', 'approver', 'admin'] then
    raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
  end if;
  if exists (select 1 from public.profiles p where p.email = p_email and p.deleted_at is null) then
    raise exception 'A user with this email already exists' using errcode = '23514', hint = 'email-taken';
  end if;
  if 'admin' = any (p_roles) and cardinality(p_roles) > 1 then
    raise exception 'An admin cannot have any other role' using errcode = '23514', hint = 'admin-exclusive';
  end if;
  select d.is_quality into quality from public.departments d
  where d.id = p_department_id and d.removed_at is null and d.deletion_job_id is null;
  if not found then
    raise exception 'Department is no longer available' using errcode = '23514', hint = 'department-unavailable';
  end if;
  if 'approver' = any (p_roles) and not quality then
    raise exception 'Approver is only allowed in the Quality department' using errcode = '23514', hint = 'approver-quality';
  end if;
end;
$$;

-- Creates the profile of an existing sign-in account, or reactivates a deleted one. All or nothing.
create function public.add_user(
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
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  -- Again, under the lock, and now no one else can add this email at the same moment.
  perform public.check_new_user(p_email, p_full_name, p_phone, p_position, p_department_id, p_roles);

  -- The account must be this person's: an admin can't attach a profile to someone else's account.
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.deleted_at is null and lower(u.email) = p_email) then
    raise exception 'Invalid user details' using errcode = '23514', hint = 'invalid';
  end if;

  select * into person from public.profiles p where p.id = p_user_id for update;
  readded := found;
  if readded and person.deleted_at is null then
    raise exception 'A user with this email already exists' using errcode = '23514', hint = 'email-taken';
  end if;

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
      end), p_department_id, p_phone, btrim(p_position));
    current_roles := '{}';
  end if;

  -- The same save as Edit User: its rules, role order and audit row.
  saved := public.save_user(p_user_id, p_full_name, p_phone, p_position, p_department_id, p_roles,
    case when readded then person.department_id else p_department_id end, current_roles);

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'add-user', p_user_id::text, jsonb_build_object('readded', readded));

  return saved || jsonb_build_object('id', p_user_id, 'email', p_email);
end;
$$;

alter function public.check_new_user(text, text, text, text, text, text[]) owner to postgres;
alter function public.add_user(uuid, text, text, text, text, text, text[]) owner to postgres;
revoke all on function public.check_new_user(text, text, text, text, text, text[]) from public, anon, authenticated, service_role;
revoke all on function public.add_user(uuid, text, text, text, text, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.check_new_user(text, text, text, text, text, text[]) to authenticated;
grant execute on function public.add_user(uuid, text, text, text, text, text, text[]) to authenticated;

notify pgrst, 'reload schema';
commit;
