-- Undoes supabase/migrations/20261116140000_organization_settings_per_organization.sql. Run as the owner
-- (postgres), only while MedCare is the only organization: public.organization_settings and
-- public.super_admin come back with MedCare's name, profile and Super Admin, and every function changed by
-- that migration gets its definition from before it (pg_get_functiondef). Grants of functions that
-- existed before are kept by CREATE OR REPLACE.
begin;

do $$
begin
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'More than one organization exists; the singletons can only hold one';
  end if;
end;
$$;

-- ---------- The tables, as they were (pg_dump) ----------
CREATE TABLE public.organization_settings (
    singleton boolean DEFAULT true NOT NULL,
    name text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    email text,
    description text,
    address text,
    maps_url text,
    website text,
    CONSTRAINT organization_settings_address_check CHECK (((address IS NULL) OR ((address = btrim(address)) AND ((char_length(address) >= 1) AND (char_length(address) <= 300)) AND (address !~ '[[:cntrl:]]'::text)))),
    CONSTRAINT organization_settings_description_check CHECK (((description IS NULL) OR ((description = btrim(description)) AND ((char_length(description) >= 1) AND (char_length(description) <= 1000))))),
    CONSTRAINT organization_settings_email_check CHECK (((email IS NULL) OR ((email = btrim(email)) AND (char_length(email) <= 254) AND (email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'::text)))),
    CONSTRAINT organization_settings_maps_url_check CHECK (((maps_url IS NULL) OR ((char_length(maps_url) <= 2048) AND (maps_url ~* '^https?://[^[:space:]/?#]+[.][^[:space:]]*$'::text)))),
    CONSTRAINT organization_settings_name_check CHECK (((name = btrim(name)) AND ((char_length(name) >= 1) AND (char_length(name) <= 200)) AND (name !~ '[[:cntrl:]]'::text))),
    CONSTRAINT organization_settings_singleton_check CHECK (singleton),
    CONSTRAINT organization_settings_website_check CHECK (((website IS NULL) OR ((char_length(website) <= 2048) AND (website ~* '^https?://[^[:space:]/?#]+[.][^[:space:]]*$'::text))))
);

CREATE TABLE public.super_admin (
    singleton boolean DEFAULT true NOT NULL,
    user_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT super_admin_singleton_check CHECK (singleton)
);

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT organization_settings_pkey PRIMARY KEY (singleton);

ALTER TABLE ONLY public.super_admin
    ADD CONSTRAINT super_admin_pkey PRIMARY KEY (singleton);

ALTER TABLE ONLY public.super_admin
    ADD CONSTRAINT super_admin_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.organization_settings
    ADD CONSTRAINT organization_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.super_admin
    ADD CONSTRAINT super_admin_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);

ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.super_admin ENABLE ROW LEVEL SECURITY;

alter table public.organization_settings owner to postgres;
alter table public.super_admin owner to postgres;
revoke all on table public.organization_settings, public.super_admin from public, anon, authenticated, service_role;

insert into public.organization_settings (singleton, name, email, description, address, maps_url, website, updated_at, updated_by)
select true, o.name, o.email, o.description, o.address, o.maps_url, o.website, o.updated_at, o.updated_by from public.organizations o;
insert into public.super_admin (singleton, user_id, assigned_at)
select true, o.super_admin_id, coalesce(o.super_admin_assigned_at, now()) from public.organizations o where o.super_admin_id is not null;

-- ---------- The functions, as they were ----------

drop trigger organizations_check_super_admin on public.organizations;
drop function public.check_organization_super_admin();
drop function public.assign_initial_super_admin(uuid, uuid);

CREATE OR REPLACE FUNCTION public.accept_access_request(p_id uuid, p_token_hash text, p_user_id uuid, p_department text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  request public.access_requests;
  words text[];
  initials text;
  -- Whether the request's organization name passes every rule of organization_settings.name.
  name_fits boolean;
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

  -- Admin is exclusive: remove any other roles first.
  delete from public.user_roles ur where ur.user_id = p_user_id and ur.role <> 'admin';
  insert into public.user_roles (user_id, role) values (p_user_id, 'admin') on conflict do nothing;

  -- The applicant is the organization's initial Super Admin.
  insert into public.super_admin (user_id) values (p_user_id);

  -- The organization's details from the request fill only what the Organization Profile doesn't have yet
  -- (null). A saved value is never overwritten; a saved name is always kept. In its own block: a value
  -- the profile refuses skips the copy, and the request is still accepted.
  name_fits := request.organization is not null
    and request.organization = pg_catalog.btrim(request.organization)
    and pg_catalog.char_length(request.organization) between 1 and 200
    and request.organization !~ '[[:cntrl:]]';
  begin
    if exists (select 1 from public.organization_settings o where o.singleton) then
      update public.organization_settings o set
        email = coalesce(o.email, request.organization_email),
        description = coalesce(o.description, request.organization_description),
        address = coalesce(o.address, request.organization_address),
        maps_url = coalesce(o.maps_url, request.organization_maps_url),
        website = coalesce(o.website, request.organization_website),
        updated_at = pg_catalog.now()
      where o.singleton and (
        (o.email is null and request.organization_email is not null)
        or (o.description is null and request.organization_description is not null)
        or (o.address is null and request.organization_address is not null)
        or (o.maps_url is null and request.organization_maps_url is not null)
        or (o.website is null and request.organization_website is not null));
    elsif name_fits then
      -- No profile yet: the row needs a name, so this only happens with a usable one.
      insert into public.organization_settings (singleton, name, email, description, address, maps_url, website, updated_at, updated_by)
      values (true, request.organization, request.organization_email, request.organization_description,
              request.organization_address, request.organization_maps_url, request.organization_website, pg_catalog.now(), null)
      on conflict (singleton) do nothing;
    else
      raise notice 'accept_access_request: the organization name of request % is not a valid profile name; the profile was not filled in', request.id;
    end if;
  exception when integrity_constraint_violation or data_exception then
    raise notice 'accept_access_request: the organization details of request % were not copied (%)', request.id, sqlerrm;
  end;

  update public.access_requests r
  set status = 'accepted', user_id = p_user_id, decided_at = now()
  where r.id = request.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assert_can_change_person(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_user_id = public.super_admin_id() and p_user_id is distinct from (select auth.uid()) then
    raise exception 'Only the Super Admin can change their details' using errcode = '42501', hint = 'super-admin-protected';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_initial_super_admin(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if exists (select 1 from public.super_admin) then
    raise exception 'A Super Admin is already assigned; use the transfer' using errcode = '23514';
  end if;
  insert into public.super_admin (user_id) values (p_user_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_super_admin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'The Super Admin can only be transferred' using errcode = '23514', hint = 'super-admin-required';
  end if;
  if not public.is_active_admin(new.user_id) then
    raise exception 'The Super Admin must be an active Admin' using errcode = '23514', hint = 'recipient-not-admin';
  end if;
  return new;
end;
$function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.deployment_onboarded()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.super_admin)
    or exists (
      select 1 from public.user_roles r join public.profiles p on p.id = r.user_id and p.deleted_at is null
      where r.role = 'admin'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.get_organization_name()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select o.name from public.organization_settings o
  where o.singleton
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.deleted_at is null);
$function$
;

CREATE OR REPLACE FUNCTION public.get_organization_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare settings public.organization_settings;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select * into settings from public.organization_settings o where o.singleton;
  if not found then return null; end if;
  return jsonb_build_object(
    'name', settings.name, 'email', settings.email, 'description', settings.description,
    'address', settings.address, 'mapsUrl', settings.maps_url, 'website', settings.website,
    'updatedAt', settings.updated_at);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_admin_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.guard_super_admin_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.save_organization_profile(p_name text, p_email text, p_description text, p_address text, p_maps_url text, p_website text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_email text := pg_catalog.btrim(coalesce(p_email, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_address text := nullif(pg_catalog.btrim(coalesce(p_address, '')), '');
  v_maps_url text := nullif(pg_catalog.btrim(coalesce(p_maps_url, '')), '');
  v_website text := nullif(pg_catalog.btrim(coalesce(p_website, '')), '');
  url_pattern constant text := '^https://[^[:space:]/?#]+[.][^[:space:]]*$';
  before public.organization_settings;
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

  select * into before from public.organization_settings o where o.singleton for update;
  changed := pg_catalog.array_remove(array[
    case when v_name is distinct from before.name then 'name' end,
    case when v_email is distinct from before.email then 'email' end,
    case when v_description is distinct from before.description then 'description' end,
    case when v_address is distinct from before.address then 'address' end,
    case when v_maps_url is distinct from before.maps_url then 'mapsUrl' end,
    case when v_website is distinct from before.website then 'website' end
  ], null);

  insert into public.organization_settings (singleton, name, email, description, address, maps_url, website, updated_at, updated_by)
  values (true, v_name, v_email, v_description, v_address, v_maps_url, v_website, pg_catalog.now(), (select auth.uid()))
  on conflict (singleton) do update set
    name = excluded.name, email = excluded.email, description = excluded.description, address = excluded.address,
    maps_url = excluded.maps_url, website = excluded.website, updated_at = excluded.updated_at, updated_by = excluded.updated_by;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'save-organization-profile', 'organization', jsonb_build_object('fields', to_jsonb(changed)));

  return public.get_organization_profile();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_organization_name(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  insert into public.organization_settings (singleton, name, updated_at, updated_by)
  values (true, v_name, pg_catalog.now(), (select auth.uid()))
  on conflict (singleton) do update
    set name = excluded.name, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return v_name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.super_admin_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select s.user_id from public.super_admin s where s.singleton;
$function$
;

CREATE OR REPLACE FUNCTION public.transfer_super_admin(p_recipient uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE TRIGGER super_admin_check BEFORE INSERT OR DELETE OR UPDATE ON public.super_admin FOR EACH ROW EXECUTE FUNCTION public.check_super_admin();
CREATE TRIGGER super_admin_no_truncate BEFORE TRUNCATE ON public.super_admin FOR EACH STATEMENT EXECUTE FUNCTION public.check_super_admin();

drop function public.super_admin_of(uuid);

alter function public.check_super_admin() owner to postgres;
alter function public.assign_initial_super_admin(uuid) owner to postgres;
revoke all on function public.check_super_admin(), public.assign_initial_super_admin(uuid)
  from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
