-- Request Hawkim asks for the organization's details, and accepting a request fills the empty parts of
-- the Organization Profile with them.
--
-- 1. public.access_requests: five new nullable columns (organization_email, organization_address,
--    organization_maps_url, organization_website, organization_description). Requests sent before this
--    migration keep null. Each column has the rule of its organization_settings column
--    (20261113150000_organization_profile.sql), allowing null, except that links must start with https://.
-- 2. submit_access_request(): five new parameters, so the 8-parameter version is dropped and the new one
--    created (SECURITY DEFINER, empty search_path, owner postgres, service_role only, as before). Body as in
--    20261112140000_admins_without_department.sql, plus the checks for new requests (the Organization
--    Profile's rules): organization email required (valid, up to 254); description required (up to 1000);
--    address (up to 300, one line) or Google Maps link (https://, up to 2048), at least one; website
--    optional (https://, up to 2048). Blank optional values are stored as null. A refused value raises
--    invalid_organization_details (the Edge Function checks the same rules first).
-- 3. get_access_request(): also returns the five values. Its result type changes, so it is dropped and
--    created again (same owner and grants: service_role only).
-- 4. accept_access_request(): same signature; body as in 20261112140000_admins_without_department.sql, plus:
--    the request's organization name, email, description, address, Google Maps link and website go into
--    organization_settings, each ONLY where nothing is saved yet (null). A saved value is never
--    overwritten. The name is copied only when it passes every rule of organization_settings.name
--    (trimmed, 1-200 characters, no control characters; no other constraint, trigger or policy applies).
--    Without a usable name and with no saved profile row, nothing is copied (the row needs a name).
--    Accepting never fails because of the copy: any refused value skips the copy (a NOTICE says so).
-- 5. save_organization_profile(): same signature; Website is optional, one of Address or Google Maps link is
--    enough, and links must start with https://. Every other rule is unchanged. Empty values are stored as null.
--    The organization_settings column checks are NOT changed: a link saved earlier with http:// stays readable,
--    and the Super Admin replaces it with an https:// link at the next save.
-- Undo: supabase/scripts/rollback_request_organization_details.sql

begin;

-- ---------- 1. The organization's details on a request ----------

alter table public.access_requests
  add column organization_email text check (organization_email is null or (
    organization_email = pg_catalog.btrim(organization_email) and pg_catalog.char_length(organization_email) <= 254
    and organization_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  add column organization_address text check (organization_address is null or (
    organization_address = pg_catalog.btrim(organization_address)
    and pg_catalog.char_length(organization_address) between 1 and 300 and organization_address !~ '[[:cntrl:]]')),
  add column organization_maps_url text check (organization_maps_url is null or (
    pg_catalog.char_length(organization_maps_url) <= 2048
    and organization_maps_url ~* '^https://[^[:space:]/?#]+[.][^[:space:]]*$')),
  add column organization_website text check (organization_website is null or (
    pg_catalog.char_length(organization_website) <= 2048
    and organization_website ~* '^https://[^[:space:]/?#]+[.][^[:space:]]*$')),
  add column organization_description text check (organization_description is null or (
    organization_description = pg_catalog.btrim(organization_description)
    and pg_catalog.char_length(organization_description) between 1 and 1000));

-- ---------- 2. submit_access_request with the organization's details ----------

drop function public.submit_access_request(text, text, text, text, text, integer, text, text);

create function public.submit_access_request(
  p_organization text, p_contact_name text, p_job_title text, p_email text, p_phone text,
  p_approx_users integer, p_message text, p_token_hash text,
  p_organization_email text, p_organization_address text, p_organization_maps_url text,
  p_organization_website text, p_organization_description text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(p_email));
  -- The organization name as compared: lower case, trimmed, inner spaces collapsed (as in the index).
  organization_key text := lower(regexp_replace(trim(p_organization), '\s+', ' ', 'g'));
  v_email text := nullif(pg_catalog.btrim(coalesce(p_organization_email, '')), '');
  v_address text := nullif(pg_catalog.btrim(coalesce(p_organization_address, '')), '');
  v_maps_url text := nullif(pg_catalog.btrim(coalesce(p_organization_maps_url, '')), '');
  v_website text := nullif(pg_catalog.btrim(coalesce(p_organization_website, '')), '');
  v_description text := nullif(pg_catalog.btrim(coalesce(p_organization_description, '')), '');
  url_pattern constant text := '^https://[^[:space:]/?#]+[.][^[:space:]]*$';
  recent integer;
  new_id uuid;
  violated text;
begin
  -- The organization's details, with the Organization Profile's rules (save_organization_profile).
  if v_email is null or pg_catalog.char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'invalid_organization_details' using errcode = 'P0001', hint = 'organization-email';
  end if;
  if v_description is null or pg_catalog.char_length(v_description) > 1000 then
    raise exception 'invalid_organization_details' using errcode = 'P0001', hint = 'organization-description';
  end if;
  if v_address is null and v_maps_url is null then
    raise exception 'invalid_organization_details' using errcode = 'P0001', hint = 'organization-address-or-maps-url';
  end if;
  if v_address is not null and (pg_catalog.char_length(v_address) > 300 or v_address ~ '[[:cntrl:]]') then
    raise exception 'invalid_organization_details' using errcode = 'P0001', hint = 'organization-address';
  end if;
  if v_maps_url is not null and (pg_catalog.char_length(v_maps_url) > 2048 or v_maps_url !~* url_pattern) then
    raise exception 'invalid_organization_details' using errcode = 'P0001', hint = 'organization-maps-url';
  end if;
  if v_website is not null and (pg_catalog.char_length(v_website) > 2048 or v_website !~* url_pattern) then
    raise exception 'invalid_organization_details' using errcode = 'P0001', hint = 'organization-website';
  end if;

  select count(*) into recent from public.access_requests r
  where r.email = normalized and r.created_at > now() - interval '24 hours';
  if recent >= 3 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.access_requests r
    where r.status in ('pending', 'accepted')
      and lower(regexp_replace(trim(r.organization), '\s+', ' ', 'g')) = organization_key
  ) then
    raise exception 'organization_taken' using errcode = 'P0001';
  end if;

  begin
    insert into public.access_requests
      (organization, contact_name, job_title, email, phone, approx_users, message, review_token_hash, review_expires_at,
       organization_email, organization_address, organization_maps_url, organization_website, organization_description)
    values
      (trim(p_organization), trim(p_contact_name), nullif(trim(coalesce(p_job_title, '')), ''), normalized, p_phone, p_approx_users,
       trim(coalesce(p_message, '')), p_token_hash, now() + interval '14 days',
       v_email, v_address, v_maps_url, v_website, v_description)
    returning id into new_id;
  exception when unique_violation then
    -- Another request for the same organization was stored at the same moment.
    get stacked diagnostics violated = constraint_name;
    if violated = 'access_requests_organization_unique' then
      raise exception 'organization_taken' using errcode = 'P0001';
    end if;
    raise;
  end;
  return new_id;
end;
$$;

-- ---------- 3. get_access_request with the organization's details ----------

drop function public.get_access_request(uuid, text);

create function public.get_access_request(p_id uuid, p_token_hash text)
returns table (
  id uuid, organization text, contact_name text, job_title text, email text, phone text,
  approx_users integer, message text, status public.access_request_status, created_at timestamptz,
  decided_at timestamptz, expired boolean, account_exists boolean,
  organization_email text, organization_address text, organization_maps_url text,
  organization_website text, organization_description text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.organization, r.contact_name, r.job_title, r.email, r.phone, r.approx_users, r.message,
         r.status, r.created_at, r.decided_at,
         r.review_expires_at < now() as expired,
         exists (select 1 from public.profiles p where p.email = r.email and p.deleted_at is null) as account_exists,
         r.organization_email, r.organization_address, r.organization_maps_url,
         r.organization_website, r.organization_description
  from public.access_requests r
  where r.id = p_id and r.review_token_hash = p_token_hash;
$$;

-- ---------- 4. accept_access_request: fill the empty parts of the Organization Profile ----------

-- As in 20261112140000_admins_without_department.sql, plus the copy into organization_settings.
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
$$;

-- ---------- 5. save_organization_profile: Website optional, Address or Google Maps link, https:// ----------

-- As in 20261113150000_organization_profile.sql, except: Website may be empty; Address and Google Maps link
-- may each be empty as long as one is given; links start with https://. Empty values are stored as null.
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
$$;

-- ---------- Owners and grants ----------

alter function public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text) owner to postgres;
alter function public.get_access_request(uuid, text) owner to postgres;
alter function public.accept_access_request(uuid, text, uuid, text) owner to postgres;
alter function public.save_organization_profile(text, text, text, text, text, text) owner to postgres;

revoke all on function public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text),
  public.get_access_request(uuid, text)
  from public, anon, authenticated;
grant execute on function public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text),
  public.get_access_request(uuid, text)
  to service_role;
-- accept_access_request (service_role only) and save_organization_profile (authenticated) keep their grants.

notify pgrst, 'reload schema';
commit;
