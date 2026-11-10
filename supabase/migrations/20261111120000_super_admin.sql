-- Super Admin and Admin management (Manage Organization → Admins).
--
-- Hawkim is single-tenant: one organization per deployment, so "the organization" is this database.
-- Both administrator levels keep the ONE existing role, 'admin' (user_roles), so has_role('admin'),
-- can_manage_organization() and every admin-only function and policy work exactly as before for both.
-- The Super Admin is a designation on top of it: public.super_admin holds at most one row (its primary
-- key can only be true), naming an active Admin. Only the Super Admin may delete Admins or transfer
-- the designation, and only the Super Admin may change the Super Admin's own details.
--
-- Rules enforced here (never only in the browser):
-- - At most one Super Admin (singleton row) and never zero once assigned (the row can't be deleted,
--   the Super Admin's profile can't be ended and their Admin role can't be removed).
-- - The Super Admin is always an active Admin; a transfer is one UPDATE of the row, under its lock,
--   so concurrent or repeated transfers can't produce two Super Admins or a partial change.
-- - The initial Super Admin is the applicant whose Request Hawkim was accepted (accept_access_request).
--   A deployment that already has an Admin can't accept another request: no second organization.
-- - Admins are managed only on the Admins page: the Staff functions can't grant or remove 'admin'
--   (add_user may still create a new Admin; it is what Add Admin uses).
-- - Every check reads the database's current state, so a former Super Admin's open session loses the
--   elevated actions immediately.
--
-- Existing data: the migration never chooses a Super Admin for a deployment that already has Admins.
-- An accepted request doesn't prove who owns the deployment (the same project may also have received
-- other organizations' requests), so it only reports the candidates. The project owner then names one
-- explicitly: `select public.assign_initial_super_admin('<user id>');` as postgres (see docs/admins.md).
-- Until then every Admin keeps working; nobody can delete Admins or transfer the role.

begin;

-- ---------- 1. The designation ----------

create table public.super_admin (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references public.profiles (id),
  assigned_at timestamptz not null default now()
);

alter table public.super_admin enable row level security;
-- No policies and no grants: read through get_super_admin_id(), changed only by the functions below.
revoke all on table public.super_admin from public, anon, authenticated, service_role;

-- The current Super Admin's id, or null before one is assigned. Internal.
create function public.super_admin_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.user_id from public.super_admin s where s.singleton;
$$;

-- An Admin who can use Hawkim now: active profile, the Admin role, and a sign-in account that is
-- neither deleted nor banned (the same account checks as can_manage_organization). Internal.
create function public.is_active_admin(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.user_roles r on r.user_id = p.id and r.role = 'admin'
    join auth.users u on u.id = p.id and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
    where p.id = p_user_id and p.deleted_at is null
  );
$$;

-- Whether the caller is the current Super Admin (and still an active Admin).
create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_manage_organization() and public.super_admin_id() = (select auth.uid());
$$;

-- For the admin portal: who the Super Admin is. Null for anyone who isn't an Admin.
create function public.get_super_admin_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select case when public.can_manage_organization() then public.super_admin_id() end;
$$;

-- The row may only name an active Admin, and is never removed.
create function public.check_super_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'The Super Admin can only be transferred' using errcode = '23514', hint = 'super-admin-required';
  end if;
  if not public.is_active_admin(new.user_id) then
    raise exception 'The Super Admin must be an active Admin' using errcode = '23514', hint = 'recipient-not-admin';
  end if;
  return new;
end;
$$;

create trigger super_admin_check before insert or update or delete on public.super_admin
for each row execute function public.check_super_admin();
create trigger super_admin_no_truncate before truncate on public.super_admin
for each statement execute function public.check_super_admin();

-- ---------- 2. Protecting the Super Admin ----------

-- Whether this is a request through the API as a signed-in (or anonymous) user: PostgREST sets the
-- role setting for every request, and SECURITY DEFINER doesn't change it. The service role (Edge
-- Functions) and the owner (migrations, maintenance) are not API users.
create function public.is_api_user_request() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('role', true), '') in ('authenticated', 'anon');
$$;

-- Only the Super Admin changes their own details; nobody ends their profile while they hold it.
-- The service role and the owner may change details, never end it.
create function public.guard_super_admin_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid());
begin
  if old.id is distinct from public.super_admin_id() then return new; end if;
  if new.deleted_at is not null and old.deleted_at is null then
    raise exception 'The Super Admin can''t be deleted; transfer the role first' using errcode = '23514', hint = 'super-admin-protected';
  end if;
  if public.is_api_user_request() and caller is distinct from old.id
    and (new.full_name, new.email, new.phone, new.initials, new."position")
      is distinct from (old.full_name, old.email, old.phone, old.initials, old."position") then
    raise exception 'Only the Super Admin can change their details' using errcode = '42501', hint = 'super-admin-protected';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_super_admin before update on public.profiles
for each row execute function public.guard_super_admin_profile();

-- 'admin' is granted only by add_user (Add Admin) and accept_access_request, and removed by no one
-- through the API: Staff can't turn staff into Admins or Admins into staff. The Super Admin's Admin
-- role is never removed. The service role and the owner are allowed.
create function public.guard_admin_role() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid := case when tg_op = 'INSERT' then new.user_id else old.user_id end;
begin
  if tg_op <> 'INSERT' and old.role = 'admin' and old.user_id = public.super_admin_id() then
    raise exception 'The Super Admin must stay an Admin' using errcode = '23514', hint = 'super-admin-protected';
  end if;
  if public.is_api_user_request()
    and ((tg_op <> 'DELETE' and new.role = 'admin') or (tg_op <> 'INSERT' and old.role = 'admin'))
    and coalesce(current_setting('hawkim.adding_user', true), '') is distinct from target::text then
    raise exception 'Admins are managed on the Admins page' using errcode = '23514', hint = 'admin-managed-separately';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger user_roles_guard_admin before insert or update or delete on public.user_roles
for each row execute function public.guard_admin_role();

-- Raised by functions that change a person's details before the triggers would see it (e.g. before
-- the sign-in email changes in update-user-email).
create function public.assert_can_change_person(p_user_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id = public.super_admin_id() and p_user_id is distinct from (select auth.uid()) then
    raise exception 'Only the Super Admin can change their details' using errcode = '42501', hint = 'super-admin-protected';
  end if;
end;
$$;

-- ---------- 3. Admin management ----------

-- Edit Admin: name and phone of an active Admin (email: update-user-email). Any Admin may edit a
-- regular Admin or themselves; only the Super Admin edits the Super Admin. The role never changes.
create function public.update_admin(p_user_id uuid, p_full_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
$$;

-- Delete Admin (Super Admin only): ends a regular Admin's profile, as deleted users are everywhere
-- else (deleted_at): they can no longer use Hawkim and their name stays on history. Nothing is removed.
create function public.delete_admin(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare person public.profiles;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin required' using errcode = '42501', hint = 'super-admin-required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  -- Under the lock: the caller may have just transferred the role.
  perform 1 from public.super_admin s where s.singleton for update;
  if not public.is_super_admin() then
    raise exception 'Super Admin required' using errcode = '42501', hint = 'super-admin-required';
  end if;
  select * into person from public.profiles p where p.id = p_user_id and p.deleted_at is null for update;
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
$$;

-- Make Super Admin: the Super Admin hands the designation to another active Admin and becomes a
-- regular Admin, in one UPDATE under the row's lock (all or nothing). Returns the new Super Admin.
create function public.transfer_super_admin(p_recipient uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  current_row public.super_admin;
  caller uuid := (select auth.uid());
begin
  if not public.can_manage_organization() then
    raise exception 'Super Admin required' using errcode = '42501', hint = 'super-admin-required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into current_row from public.super_admin s where s.singleton for update;
  -- Checked under the lock: a repeated or concurrent request finds the role already moved.
  if not found or current_row.user_id is distinct from caller or not public.can_manage_organization() then
    raise exception 'Super Admin required' using errcode = '42501', hint = 'super-admin-required';
  end if;
  if p_recipient is null or p_recipient = caller then
    raise exception 'Choose another Admin' using errcode = '23514', hint = 'recipient-self';
  end if;
  perform 1 from public.profiles p where p.id = p_recipient for update;
  if not public.is_active_admin(p_recipient) then
    raise exception 'The new Super Admin must be an active Admin' using errcode = '23514', hint = 'recipient-not-admin';
  end if;
  update public.super_admin s set user_id = p_recipient, assigned_at = now() where s.singleton;
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values (caller, 'transfer-super-admin', p_recipient::text, jsonb_build_object(
    'previousSuperAdminId', caller, 'newSuperAdminId', p_recipient,
    'before', jsonb_build_object(caller::text, 'super-admin', p_recipient::text, 'admin'),
    'after', jsonb_build_object(caller::text, 'admin', p_recipient::text, 'super-admin')));
  return p_recipient;
end;
$$;

-- For the project owner (as postgres) when the migration couldn't tell who the Super Admin is.
-- Only while there is none; afterwards the role only moves by transfer.
create function public.assign_initial_super_admin(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if exists (select 1 from public.super_admin) then
    raise exception 'A Super Admin is already assigned; use the transfer' using errcode = '23514';
  end if;
  insert into public.super_admin (user_id) values (p_user_id);
end;
$$;

-- ---------- 4. Existing functions, with the new rules ----------

-- As in 20261110120000_staff_management.sql, plus: the new person's Admin role is allowed
-- (hawkim.adding_user, transaction-local; only this function sets it).
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

-- As in 20261110120000_staff_management.sql, plus: only the Super Admin changes the Super Admin's
-- email, refused already in the dry run (before update-user-email changes the sign-in account).
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
  select * into person from public.profiles p where p.id = p_user_id and p.deleted_at is null for update;
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

-- For the access-requests Edge Function, before it creates an account: has this deployment already
-- been set up for its organization (any active Admin, or a Super Admin)?
create function public.deployment_onboarded() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.super_admin)
    or exists (
      select 1 from public.user_roles r join public.profiles p on p.id = r.user_id and p.deleted_at is null
      where r.role = 'admin'
    );
$$;

-- As in 20261106130000_access_requests.sql, plus: the applicant becomes the Super Admin, and a
-- deployment that already has an Admin accepts no other organization.
create or replace function public.accept_access_request(p_id uuid, p_token_hash text, p_user_id uuid, p_department text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.access_requests;
  words text[];
  initials text;
begin
  request := public.lock_pending_access_request(p_id, p_token_hash);
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);

  if public.deployment_onboarded() then
    raise exception 'deployment_onboarded' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where p.email = request.email and p.deleted_at is null) then
    raise exception 'email_in_use' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.departments d where d.id = p_department and d.removed_at is null) then
    raise exception 'department_not_found' using errcode = 'P0001';
  end if;

  words := regexp_split_to_array(request.contact_name, '\s+');
  initials := upper(case
    when array_length(words, 1) >= 2 then left(words[1], 1) || left(words[array_length(words, 1)], 1)
    else left(words[1], 2)
  end);

  insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
  values (p_user_id, request.contact_name, request.email, initials, p_department, request.phone, request.job_title)
  on conflict (id) do update set
    full_name = excluded.full_name, email = excluded.email, initials = excluded.initials,
    department_id = excluded.department_id, phone = excluded.phone, "position" = excluded."position",
    deleted_at = null;

  -- Admin is exclusive: remove any other roles first.
  delete from public.user_roles ur where ur.user_id = p_user_id and ur.role <> 'admin';
  insert into public.user_roles (user_id, role) values (p_user_id, 'admin') on conflict do nothing;

  -- The applicant is the organization's initial Super Admin.
  insert into public.super_admin (user_id) values (p_user_id);

  update public.access_requests r
  set status = 'accepted', user_id = p_user_id, decided_at = now()
  where r.id = request.id;
end;
$$;

-- ---------- 5. Owners and grants ----------

alter table public.super_admin owner to postgres;
alter function public.super_admin_id() owner to postgres;
alter function public.is_active_admin(uuid) owner to postgres;
alter function public.is_super_admin() owner to postgres;
alter function public.get_super_admin_id() owner to postgres;
alter function public.check_super_admin() owner to postgres;
alter function public.is_api_user_request() owner to postgres;
alter function public.guard_super_admin_profile() owner to postgres;
alter function public.guard_admin_role() owner to postgres;
alter function public.assert_can_change_person(uuid) owner to postgres;
alter function public.update_admin(uuid, text, text) owner to postgres;
alter function public.delete_admin(uuid) owner to postgres;
alter function public.transfer_super_admin(uuid) owner to postgres;
alter function public.assign_initial_super_admin(uuid) owner to postgres;
alter function public.add_user(uuid, text, text, text, text, text, text[]) owner to postgres;
alter function public.set_user_email(uuid, text, boolean) owner to postgres;
alter function public.deployment_onboarded() owner to postgres;
alter function public.accept_access_request(uuid, text, uuid, text) owner to postgres;

revoke all on function public.super_admin_id(), public.is_active_admin(uuid), public.is_super_admin(),
  public.get_super_admin_id(), public.check_super_admin(), public.is_api_user_request(), public.guard_super_admin_profile(),
  public.guard_admin_role(), public.assert_can_change_person(uuid), public.update_admin(uuid, text, text),
  public.delete_admin(uuid), public.transfer_super_admin(uuid), public.assign_initial_super_admin(uuid),
  public.deployment_onboarded()
  from public, anon, authenticated, service_role;

grant execute on function public.get_super_admin_id(), public.is_super_admin(), public.update_admin(uuid, text, text),
  public.delete_admin(uuid), public.transfer_super_admin(uuid) to authenticated;
grant execute on function public.deployment_onboarded() to service_role;
-- Unchanged from before: add_user and set_user_email for signed-in callers (checked inside);
-- accept_access_request for the access-requests Edge Function only.
revoke all on function public.add_user(uuid, text, text, text, text, text, text[]),
  public.set_user_email(uuid, text, boolean), public.accept_access_request(uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.add_user(uuid, text, text, text, text, text, text[]),
  public.set_user_email(uuid, text, boolean) to authenticated;
grant execute on function public.accept_access_request(uuid, text, uuid, text) to service_role;

-- ---------- 6. Existing deployments ----------

-- Reports only: no one is made Super Admin here (see the top of this file).
do $$
declare
  candidates integer;
  admins integer;
begin
  if exists (select 1 from public.super_admin) then return; end if;
  select count(distinct r.user_id) into candidates
  from public.access_requests r
  where r.status = 'accepted' and r.user_id is not null and public.is_active_admin(r.user_id);
  select count(*) into admins
  from public.user_roles r join public.profiles p on p.id = r.user_id and p.deleted_at is null where r.role = 'admin';
  if admins > 0 then
    raise warning 'No Super Admin assigned: % active Admin(s), % of them accepted Request Hawkim applicant(s). The project owner names one: select public.assign_initial_super_admin(''<user id>''); as postgres.',
      admins, candidates;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
