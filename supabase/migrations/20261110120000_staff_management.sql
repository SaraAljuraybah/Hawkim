-- Staff Management (Tasks 7–16) on top of save_user / add_user / check_new_user.
--
-- 1. System Admin accounts (role 'admin', which is never held with another role) have no
--    department and no position. Every other active profile still needs a department: checked at
--    commit time, so a profile and its roles can be saved together. Existing rows all have one.
-- 2. Department transfer restriction: a staff member can't move to another department while they
--    have SOP responsibilities in progress (Author, Co-author, Reviewer, Approver). Enforced by a
--    trigger on profiles.department_id, so no path can bypass it, and serialized against new SOP
--    assignments by locking the assignee's profile. Nothing in the SOP workflow is changed.
-- 3. set_user_email: the profile email follows the sign-in email (the update-user-email Edge
--    Function changes the Auth account first, then calls this).
--
-- Additive: no column or table is removed or renamed; save_user, add_user and check_new_user keep
-- their signatures and existing behavior for staff. Undo: supabase/scripts/rollback_staff_management.sql

begin;

-- ---------- 1. System Admin accounts without a department ----------

alter table public.profiles alter column department_id drop not null;

-- The active-department guard applies only when a department is set.
drop trigger profiles_active_department on public.profiles;
create trigger profiles_active_department before insert or update of department_id on public.profiles
for each row when (new.department_id is not null) execute function public.guard_active_department();

create function public.assert_staff_has_department(p_profile_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles p
      where p.id = p_profile_id and p.deleted_at is null and p.department_id is null
        and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')) then
    raise exception 'A department is required for staff' using errcode = '23514', hint = 'department-required';
  end if;
end; $$;
create function public.require_profile_department() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.assert_staff_has_department(new.id); return null; end; $$;
create function public.require_role_department() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.assert_staff_has_department(old.user_id); return null; end; $$;
-- Queued only when it can matter: an active profile left without a department, or Admin removed.
create constraint trigger profiles_require_department after insert or update of department_id, deleted_at on public.profiles
deferrable initially deferred for each row when (new.department_id is null and new.deleted_at is null)
execute function public.require_profile_department();
create constraint trigger user_roles_require_department after update or delete on public.user_roles
deferrable initially deferred for each row when (old.role = 'admin') execute function public.require_role_department();

-- ---------- 2. Department transfer restriction ----------

-- The SOPs on which this person still has work, per responsibility, using the workflow's own rules
-- (the same ones save_user uses for "permission in use"):
-- - author / co-author: the SOP isn't published yet (published is the only finished status);
-- - reviewer: the SOP is in review, in approval, returned or approved, and their latest request in
--   the latest round is pending, accepted, completed or returned (a returned SOP comes back to them);
-- - approver: approver assignments aren't stored in the database, so anyone holding Approver is
--   responsible for every SOP waiting for approval (in approval) or publication (approved).
-- Only counts are returned: an admin may not be allowed to see the SOPs themselves.
create function public.sop_responsibilities_in_progress(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with active as (select s.* from public.sops s where s.deleted_at is null),
  authored as (select a.id from active a where a.status <> 'published' and a.author_id = p_user_id),
  coauthored as (select a.id from active a where a.status <> 'published' and a.author_id <> p_user_id and public.is_co_author(a.id, p_user_id)),
  reviewing as (
    select a.id from active a
    where a.status in ('in-review', 'in-approval', 'returned', 'approved')
      and (
        select q.status from public.review_requests q
        where q.sop_id = a.id and q.reviewer_id = p_user_id
          and q.round_id = (select r.id from public.review_rounds r where r.sop_id = a.id order by r.requested_at desc, r.id desc limit 1)
        order by q.seq desc limit 1
      ) in ('pending', 'accepted', 'completed', 'returned')
  ),
  approving as (
    select a.id from active a
    where a.status in ('in-approval', 'approved')
      and exists (select 1 from public.user_roles r where r.user_id = p_user_id and r.role = 'approver')
  ),
  every_sop as (select id from authored union select id from coauthored union select id from reviewing union select id from approving)
  select jsonb_build_object(
    'total', (select count(*) from every_sop),
    'author', (select count(*) from authored),
    'co-author', (select count(*) from coauthored),
    'reviewer', (select count(*) from reviewing),
    'approver', (select count(*) from approving)
  );
$$;

-- Refuses moving this person to another department while they have SOP work in progress. The
-- caller must hold their profile row (FOR UPDATE, or the UPDATE itself): new assignments wait for it
-- (see lock_sop_assignee), and this sees every assignment committed before it.
create function public.assert_department_transfer_allowed(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare summary jsonb := public.sop_responsibilities_in_progress(p_user_id);
begin
  if (summary->>'total')::integer > 0 then
    raise exception 'Department transfer not allowed: SOP responsibilities in progress'
      using errcode = '23514', hint = 'department-transfer-blocked',
        detail = concat_ws(',', 'total:' || (summary->>'total'),
          nullif('author:' || (summary->>'author'), 'author:0'),
          nullif('co-author:' || (summary->>'co-author'), 'co-author:0'),
          nullif('reviewer:' || (summary->>'reviewer'), 'reviewer:0'),
          nullif('approver:' || (summary->>'approver'), 'approver:0'));
  end if;
end; $$;

-- Any change of an existing home department (not a System Admin getting one for the first time),
-- whatever path makes it. save_user also checks before it changes any role (an Approver removed in
-- the same save is still counted).
create function public.guard_department_transfer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.department_id is null or new.deleted_at is not null then return new; end if;
  perform public.assert_department_transfer_allowed(new.id);
  return new;
end; $$;
create trigger profiles_department_transfer_guard before update of department_id on public.profiles
for each row when (old.department_id is distinct from new.department_id) execute function public.guard_department_transfer();

-- A new SOP responsibility locks the assignee's profile (shared), so it can't interleave with a
-- department change of the same person: whichever commits first is seen by the other.
create function public.lock_sop_assignee() returns trigger
language plpgsql security definer set search_path = '' as $$
declare assignee uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
begin
  if assignee is not null then
    perform 1 from public.profiles p where p.id = assignee for share;
  end if;
  return new;
end; $$;
create trigger sops_lock_author before insert or update of author_id on public.sops
for each row execute function public.lock_sop_assignee('author_id');
-- Named to fire before sop_co_authors_check (triggers fire in name order), so that check sees the
-- co-author's department as it is once any transfer of theirs has committed.
create trigger sop_co_authors_a_lock_assignee before insert or update on public.sop_co_authors
for each row execute function public.lock_sop_assignee('user_id');
create trigger review_requests_lock_assignee before insert or update of reviewer_id, status on public.review_requests
for each row execute function public.lock_sop_assignee('reviewer_id');

-- An SOP reaching approval or publication makes every Approver responsible: lock their profiles too.
create function public.lock_sop_approvers() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.profiles p
  where p.deleted_at is null and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'approver')
  order by p.id
  for share of p;
  return new;
end; $$;
create trigger sops_lock_approvers before insert or update of status on public.sops
for each row when (new.status in ('in-approval', 'approved')) execute function public.lock_sop_approvers();

-- ---------- 3. Saving staff and System Admin accounts ----------

-- Same rules as before; a System Admin (roles = {admin}) needs no department or position.
create or replace function public.check_new_user(
  p_email text, p_full_name text, p_phone text, p_position text, p_department_id text, p_roles text[]
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

-- As before; a System Admin is created without a department or position.
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

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'add-user', p_user_id::text, jsonb_build_object('readded', readded));

  return saved || jsonb_build_object('id', p_user_id, 'email', p_email);
end;
$$;

-- As before, plus: a System Admin's department and position are kept as they are (p_department_id
-- and p_position are ignored); everyone else needs both. A department change is checked by
-- profiles_department_transfer_guard.
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

-- ---------- 4. Email ----------

-- Admin-only. With p_apply false it only validates (the Edge Function's dry run before it changes the
-- sign-in account); with true, the Auth account must already have this email.
create function public.set_user_email(p_user_id uuid, p_email text, p_apply boolean) returns text
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
  select * into person from public.profiles p where p.id = p_user_id and p.deleted_at is null for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
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

alter function public.check_new_user(text, text, text, text, text, text[]) owner to postgres;
alter function public.add_user(uuid, text, text, text, text, text, text[]) owner to postgres;
alter function public.save_user(uuid, text, text, text, text, text[], text, text[]) owner to postgres;
alter function public.set_user_email(uuid, text, boolean) owner to postgres;
alter function public.sop_responsibilities_in_progress(uuid) owner to postgres;
alter function public.assert_staff_has_department(uuid) owner to postgres;
alter function public.guard_department_transfer() owner to postgres;
alter function public.assert_department_transfer_allowed(uuid) owner to postgres;
alter function public.lock_sop_assignee() owner to postgres;
alter function public.lock_sop_approvers() owner to postgres;
alter function public.require_profile_department() owner to postgres;
alter function public.require_role_department() owner to postgres;

revoke all on function public.set_user_email(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_user_email(uuid, text, boolean) to authenticated;
-- Internal helpers: only the triggers and RPCs above call them.
revoke all on function public.sop_responsibilities_in_progress(uuid), public.assert_department_transfer_allowed(uuid), public.assert_staff_has_department(uuid),
  public.guard_department_transfer(), public.lock_sop_assignee(), public.lock_sop_approvers(),
  public.require_profile_department(), public.require_role_department()
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
