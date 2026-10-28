-- Phase 2: departments, user profiles and roles, with the role rules and row level security.
--
-- Rules enforced here (never only in the browser):
-- - A person can have several roles: author, reviewer, approver, admin.
-- - Approver is allowed only in the Quality department (departments.is_quality).
-- - Admin is exclusive: an admin has no other role.
-- - Any department can have employees with no role (no rows in user_roles).
--
-- The browser can only read these tables, and only when signed in to an active profile.
-- Accounts, profiles and roles are managed from the Supabase dashboard for now.

-- ---------- Types ----------

create type public.app_role as enum ('author', 'reviewer', 'approver', 'admin');

-- ---------- Tables ----------

create table public.departments (
  -- A readable id that never changes, e.g. 'quality-assurance'.
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(trim(name)) between 1 and 100),
  -- Short abbreviation for the initials circle, e.g. 'QA'.
  initials text not null check (length(initials) between 1 and 4),
  description text not null default '' check (length(description) <= 500),
  -- The Quality department: the only one where people can be Approvers.
  is_quality boolean not null default false,
  -- Set when the department is removed; it stays so old records keep its name.
  removed_at timestamptz,
  created_at timestamptz not null default now()
);

-- At most one Quality department.
create unique index departments_one_quality on public.departments (is_quality) where is_quality;

create table public.profiles (
  -- The same id as the sign-in account. Not deleted with it: a person's name must stay on SOP
  -- history, so a profile is ended with deleted_at instead.
  id uuid primary key references auth.users (id),
  full_name text not null check (length(trim(full_name)) between 1 and 100),
  email text not null check (email = lower(trim(email)) and email like '%_@_%'),
  initials text not null check (length(initials) between 1 and 4),
  -- The home department.
  department_id text not null references public.departments (id),
  -- Set when the person no longer has access; their name stays on history.
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- One active profile per email.
create unique index profiles_active_email on public.profiles (email) where deleted_at is null;
create index profiles_department on public.profiles (department_id);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------- Role rules ----------

-- A role being added or changed: Approver only in Quality; Admin never with another role.
create function public.check_user_role() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  quality boolean;
begin
  -- Lock the person's profile so two role changes at the same moment are checked one after the other.
  select d.is_quality into quality
  from public.profiles p
  join public.departments d on d.id = p.department_id
  where p.id = new.user_id
  for update of p;

  if new.role = 'approver' and not coalesce(quality, false) then
    raise exception 'Approver is only allowed in the Quality department' using errcode = 'check_violation';
  end if;

  if new.role = 'admin' and exists (
    select 1 from public.user_roles r where r.user_id = new.user_id and r.role <> 'admin'
  ) then
    raise exception 'An admin cannot have any other role' using errcode = 'check_violation';
  end if;

  if new.role <> 'admin' and exists (
    select 1 from public.user_roles r where r.user_id = new.user_id and r.role = 'admin'
  ) then
    raise exception 'An admin cannot have any other role' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger user_roles_check
before insert or update on public.user_roles
for each row execute function public.check_user_role();

-- A person moving to another department: an Approver can only move to Quality.
create function public.check_profile_department() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.user_roles r where r.user_id = new.id and r.role = 'approver')
     and not exists (select 1 from public.departments d where d.id = new.department_id and d.is_quality) then
    raise exception 'An Approver can only belong to the Quality department' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger profiles_department_check
before update of department_id on public.profiles
for each row
when (old.department_id is distinct from new.department_id)
execute function public.check_profile_department();

-- A department stops being Quality: refused while it still has Approvers.
create function public.check_department_quality() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.profiles p
    join public.user_roles r on r.user_id = p.id and r.role = 'approver'
    where p.department_id = new.id
  ) then
    raise exception 'This department still has Approvers, so it must stay the Quality department' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger departments_quality_check
before update of is_quality on public.departments
for each row
when (old.is_quality and not new.is_quality)
execute function public.check_department_quality();

-- ---------- Helper functions (used by row level security) ----------

-- The signed-in person has a profile that hasn't been ended.
create function public.is_active_user() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.deleted_at is null
  );
$$;

-- The signed-in, active person has this role.
create function public.has_role(wanted public.app_role) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    join public.user_roles r on r.user_id = p.id
    where p.id = (select auth.uid()) and p.deleted_at is null and r.role = wanted
  );
$$;

-- Only signed-in users can call the helpers; the trigger functions are never called directly.
revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.has_role(public.app_role) from public, anon;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.has_role(public.app_role) to authenticated;
revoke execute on function public.check_user_role() from public, anon, authenticated;
revoke execute on function public.check_profile_department() from public, anon, authenticated;
revoke execute on function public.check_department_quality() from public, anon, authenticated;

-- ---------- Row level security ----------

alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

-- Read only, and only for a signed-in person with an active profile. Removed departments and
-- ended profiles stay readable, so old records can still show their names.
create policy "Active users can read departments"
on public.departments for select to authenticated
using ((select public.is_active_user()));

create policy "Active users can read profiles"
on public.profiles for select to authenticated
using ((select public.is_active_user()));

create policy "Active users can read roles"
on public.user_roles for select to authenticated
using ((select public.is_active_user()));

-- No insert, update or delete policies: the browser can't change these tables. Grants are
-- narrowed as well, so this holds even if a policy is added by mistake.
revoke all on public.departments, public.profiles, public.user_roles from anon, authenticated;
grant select on public.departments, public.profiles, public.user_roles to authenticated;
