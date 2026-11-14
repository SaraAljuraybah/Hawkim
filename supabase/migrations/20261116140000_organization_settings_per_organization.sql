-- Multi-tenant, step 2: the organization's name, profile and Super Admin live on public.organizations.
--
-- The singletons public.organization_settings (name and Organization Profile) and public.super_admin
-- (the Super Admin designation) are replaced by the columns of public.organizations
-- (20261116120000_organizations.sql), one row per organization. Their values are copied once more
-- (anything that changed since that migration, e.g. on a local database by the seed), then the two
-- tables are dropped. public.sop_code_counter stays until SOP codes are numbered per organization.
--
-- The functions keep their names, signatures and grants, so the website and the Edge Functions call
-- them as before; each one now reads or writes the caller's organization:
--   super_admin_id()            the Super Admin of the caller's organization (null without one)
--   super_admin_of(org)         NEW, internal: the Super Admin of a given organization
--   is_super_admin(), get_super_admin_id()   unchanged bodies (they use super_admin_id())
--   guard_super_admin_profile, guard_admin_role, assert_can_change_person
--                               protect the Super Admin of the person's own organization
--   delete_admin                the Admin must be in the caller's organization
--   transfer_super_admin        the recipient must be an active Admin of the caller's organization
--   assign_initial_super_admin  now (organization, person): the owner names a Super Admin for an
--                               organization that has none (the old one-argument version is dropped)
--   check_organization_super_admin   NEW trigger on organizations, replacing check_super_admin on the
--                               dropped table: the Super Admin is an active Admin and, once assigned,
--                               never removed (only transferred)
--   deployment_onboarded        any organization with a Super Admin, or any active Admin (as before;
--                               removed when each accepted request creates its own organization)
--   accept_access_request       makes the applicant the Super Admin of their organization and fills
--                               the organization's empty profile fields from the request (as before)
--   get_organization_name, set_organization_name, get_organization_profile, save_organization_profile
--                               the caller's organization
-- Every organization has a name, so get_organization_profile returns its profile (name and the fields
-- saved so far) instead of null; the website already shows missing fields as empty.
--
-- The one advisory lock (72441, 1) is kept as it is: every staff and organization change still takes it,
-- and it becomes one lock per organization for all of them together (scoping the staff functions).
--
-- Undo (only while MedCare is the only organization): supabase/scripts/rollback_organization_settings_per_organization.sql

begin;

-- ---------- 1. The last copy from the singletons ----------

do $$
begin
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'Expected exactly one organization (MedCare) before dropping the singletons';
  end if;
end;
$$;

update public.organizations o set
  name = coalesce(nullif(pg_catalog.btrim(s.name), ''), o.name),
  email = s.email, description = s.description, address = s.address, maps_url = s.maps_url, website = s.website,
  updated_at = s.updated_at, updated_by = s.updated_by
from public.organization_settings s
where s.singleton;

update public.organizations o set super_admin_id = sa.user_id, super_admin_assigned_at = sa.assigned_at
from public.super_admin sa
where sa.singleton;

-- ---------- 2. The Super Admin of an organization ----------

-- Internal: the Super Admin of this organization, or null.
create function public.super_admin_of(p_organization_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select o.super_admin_id from public.organizations o where o.id = p_organization_id;
$$;

-- The Super Admin of the caller's organization, or null. Internal.
create or replace function public.super_admin_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select public.super_admin_of(public.current_organization_id());
$$;

-- The Super Admin is an active Admin of the organization (the composite foreign key keeps them in it)
-- and, once assigned, is only ever transferred, never removed.
create function public.check_organization_super_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.super_admin_id is not null and new.super_admin_id is null then
    raise exception 'The Super Admin can only be transferred' using errcode = '23514', hint = 'super-admin-required';
  end if;
  if new.super_admin_id is not null and new.super_admin_id is distinct from (case when tg_op = 'UPDATE' then old.super_admin_id end)
    and not public.is_active_admin(new.super_admin_id) then
    raise exception 'The Super Admin must be an active Admin' using errcode = '23514', hint = 'recipient-not-admin';
  end if;
  return new;
end;
$$;

create trigger organizations_check_super_admin before insert or update of super_admin_id on public.organizations
for each row execute function public.check_organization_super_admin();

-- As in 20261111120000_super_admin.sql, for the Super Admin of the person's own organization.
create or replace function public.guard_super_admin_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid());
begin
  if old.id is distinct from public.super_admin_of(old.organization_id) then return new; end if;
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

-- As in 20261111120000_super_admin.sql, for the Super Admin of the role's organization.
create or replace function public.guard_admin_role() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid := case when tg_op = 'INSERT' then new.user_id else old.user_id end;
begin
  if tg_op <> 'INSERT' and old.role = 'admin' and old.user_id = public.super_admin_of(old.organization_id) then
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

-- As in 20261111120000_super_admin.sql: only the Super Admin changes the Super Admin's details (the
-- Super Admin of that person's organization).
create or replace function public.assert_can_change_person(p_user_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_user_id = public.super_admin_of((select p.organization_id from public.profiles p where p.id = p_user_id))
    and p_user_id is distinct from (select auth.uid()) then
    raise exception 'Only the Super Admin can change their details' using errcode = '42501', hint = 'super-admin-protected';
  end if;
end;
$$;

-- As in 20261111120000_super_admin.sql, with the organization's row as the lock, and only an Admin of
-- the caller's organization.
create or replace function public.delete_admin(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
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
$$;

-- As in 20261111120000_super_admin.sql: one UPDATE of the organization's row, under its lock. The
-- recipient must be an active Admin of the same organization.
create or replace function public.transfer_super_admin(p_recipient uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
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
$$;

-- For the project owner (as postgres): names the Super Admin of an organization that has none.
-- Afterwards the role only moves by transfer.
drop function public.assign_initial_super_admin(uuid);
create function public.assign_initial_super_admin(p_organization_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
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
$$;

-- For the access-requests Edge Function, as before: has an organization been set up (any Super Admin,
-- or any active Admin)?
create or replace function public.deployment_onboarded() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations o where o.super_admin_id is not null)
    or exists (
      select 1 from public.user_roles r join public.profiles p on p.id = r.user_id and p.deleted_at is null
      where r.role = 'admin'
    );
$$;

-- As in 20261115120000_request_organization_details.sql, with the organization's row instead of the
-- singletons: the applicant becomes the Super Admin of the organization their profile is in, and the
-- request's organization details fill only that organization's empty profile fields (its name is kept).
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
  v_organization uuid;
begin
  request := public.lock_pending_access_request(p_id, p_token_hash);
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);

  if public.deployment_onboarded() then
    raise exception 'deployment_onboarded' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where p.email = request.email and p.deleted_at is null) then
    raise exception 'email_in_use' using errcode = 'P0001';
  end if;

  words := regexp_split_to_array(request.contact_name, '\s+');
  initials := upper(case
    when array_length(words, 1) >= 2 then left(words[1], 1) || left(words[array_length(words, 1)], 1)
    else left(words[1], 2)
  end);

  -- An Admin has no department and no position (the deferred "staff need a department" rule exempts
  -- Admins; the role below is in place before it is checked at commit).
  insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
  values (p_user_id, request.contact_name, request.email, initials, null, request.phone, null)
  on conflict (id) do update set
    full_name = excluded.full_name, email = excluded.email, initials = excluded.initials,
    department_id = null, phone = excluded.phone, "position" = null,
    deleted_at = null;
  select p.organization_id into v_organization from public.profiles p where p.id = p_user_id;

  -- Admin is exclusive: remove any other roles first.
  delete from public.user_roles ur where ur.user_id = p_user_id and ur.role <> 'admin';
  insert into public.user_roles (user_id, role) values (p_user_id, 'admin') on conflict do nothing;

  -- The applicant is the organization's initial Super Admin.
  update public.organizations o
  set super_admin_id = p_user_id, super_admin_assigned_at = now(), access_request_id = coalesce(o.access_request_id, request.id)
  where o.id = v_organization;

  -- The organization's details from the request fill only what its profile doesn't have yet (null).
  -- A saved value is never overwritten; the name is always kept. In its own block: a value the profile
  -- refuses skips the copy, and the request is still accepted.
  begin
    update public.organizations o set
      email = coalesce(o.email, request.organization_email),
      description = coalesce(o.description, request.organization_description),
      address = coalesce(o.address, request.organization_address),
      maps_url = coalesce(o.maps_url, request.organization_maps_url),
      website = coalesce(o.website, request.organization_website),
      updated_at = pg_catalog.now()
    where o.id = v_organization and (
      (o.email is null and request.organization_email is not null)
      or (o.description is null and request.organization_description is not null)
      or (o.address is null and request.organization_address is not null)
      or (o.maps_url is null and request.organization_maps_url is not null)
      or (o.website is null and request.organization_website is not null));
  exception when integrity_constraint_violation or data_exception then
    raise notice 'accept_access_request: the organization details of request % were not copied (%)', request.id, sqlerrm;
  end;

  update public.access_requests r
  set status = 'accepted', user_id = p_user_id, decided_at = now(), organization_id = v_organization
  where r.id = request.id;
end;
$$;

-- ---------- 3. The name and the Organization Profile ----------

-- The caller's organization's name, or null for a caller without an active profile.
create or replace function public.get_organization_name() returns text
language sql stable security definer set search_path = '' as $$
  select o.name from public.organizations o where o.id = public.current_organization_id();
$$;

-- Saves the caller's organization's name (trimmed) and returns it. Only its Super Admin.
create or replace function public.set_organization_name(p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can change the organization name'
      using errcode = '42501', hint = 'super-admin-required';
  end if;
  if pg_catalog.char_length(v_name) not between 1 and 200 or v_name ~ '[[:cntrl:]]' then
    raise exception 'The organization name must be 1 to 200 characters on one line'
      using errcode = '22023', hint = 'invalid';
  end if;
  update public.organizations o set name = v_name, updated_at = pg_catalog.now(), updated_by = (select auth.uid())
  where o.id = public.current_organization_id();
  return v_name;
end;
$$;

-- The caller's organization's profile. Active Admins only.
create or replace function public.get_organization_profile() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare org public.organizations;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select * into org from public.organizations o where o.id = public.current_organization_id();
  if not found then return null; end if;
  return jsonb_build_object(
    'name', org.name, 'email', org.email, 'description', org.description,
    'address', org.address, 'mapsUrl', org.maps_url, 'website', org.website,
    'updatedAt', org.updated_at);
end;
$$;

-- As in 20261113150000_organization_profile.sql (latest), for the caller's organization. Only its
-- Super Admin.
create or replace function public.save_organization_profile(
  p_name text, p_email text, p_description text, p_address text, p_maps_url text, p_website text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_email text := pg_catalog.btrim(coalesce(p_email, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_address text := nullif(pg_catalog.btrim(coalesce(p_address, '')), '');
  v_maps_url text := nullif(pg_catalog.btrim(coalesce(p_maps_url, '')), '');
  v_website text := nullif(pg_catalog.btrim(coalesce(p_website, '')), '');
  url_pattern constant text := '^https://[^[:space:]/?#]+[.][^[:space:]]*$';
  before public.organizations;
  changed text[];
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can change the organization profile'
      using errcode = '42501', hint = 'super-admin-required';
  end if;
  if pg_catalog.char_length(v_name) not between 1 and 200 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Invalid organization name' using errcode = '22023', hint = 'name';
  end if;
  if pg_catalog.char_length(v_email) not between 1 and 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Invalid organization email' using errcode = '22023', hint = 'email';
  end if;
  if pg_catalog.char_length(v_description) not between 1 and 1000 then
    raise exception 'Invalid description' using errcode = '22023', hint = 'description';
  end if;
  if v_address is null and v_maps_url is null then
    raise exception 'An address or a Google Maps link is required' using errcode = '22023', hint = 'address-or-maps-url';
  end if;
  if v_address is not null and (pg_catalog.char_length(v_address) > 300 or v_address ~ '[[:cntrl:]]') then
    raise exception 'Invalid address' using errcode = '22023', hint = 'address';
  end if;
  if v_maps_url is not null and (pg_catalog.char_length(v_maps_url) > 2048 or v_maps_url !~* url_pattern) then
    raise exception 'Invalid Google Maps link' using errcode = '22023', hint = 'maps-url';
  end if;
  if v_website is not null and (pg_catalog.char_length(v_website) > 2048 or v_website !~* url_pattern) then
    raise exception 'Invalid website' using errcode = '22023', hint = 'website';
  end if;

  select * into before from public.organizations o where o.id = public.current_organization_id() for update;
  changed := pg_catalog.array_remove(array[
    case when v_name is distinct from before.name then 'name' end,
    case when v_email is distinct from before.email then 'email' end,
    case when v_description is distinct from before.description then 'description' end,
    case when v_address is distinct from before.address then 'address' end,
    case when v_maps_url is distinct from before.maps_url then 'mapsUrl' end,
    case when v_website is distinct from before.website then 'website' end
  ], null);

  update public.organizations o set
    name = v_name, email = v_email, description = v_description, address = v_address,
    maps_url = v_maps_url, website = v_website, updated_at = pg_catalog.now(), updated_by = (select auth.uid())
  where o.id = before.id;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'save-organization-profile', 'organization', jsonb_build_object('fields', to_jsonb(changed)));

  return public.get_organization_profile();
end;
$$;

-- ---------- 4. The singletons go ----------

drop table public.super_admin;          -- with its triggers super_admin_check and super_admin_no_truncate
drop function public.check_super_admin();
drop table public.organization_settings;

-- ---------- 5. Owners and grants ----------

alter function public.super_admin_of(uuid) owner to postgres;
alter function public.super_admin_id() owner to postgres;
alter function public.check_organization_super_admin() owner to postgres;
alter function public.assign_initial_super_admin(uuid, uuid) owner to postgres;
revoke all on function public.super_admin_of(uuid), public.check_organization_super_admin(),
  public.assign_initial_super_admin(uuid, uuid)
  from public, anon, authenticated, service_role;
-- Every other function keeps its owner and grants (CREATE OR REPLACE).

notify pgrst, 'reload schema';
commit;
