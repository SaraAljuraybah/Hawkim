-- Organization Profile (admin portal): the organization's name, email, description, address, Google Maps
-- link and website, viewed by every active Admin and edited by the Super Admin.
--
-- - The five new values are added to the one organization_settings row, next to the name. They are
--   nullable: nothing is filled in or copied here (Request Hawkim never collected an organization email,
--   address, map link or website, and its message is not a description), so existing deployments show
--   them as not set until the Super Admin saves them. The saved name is kept as it is.
-- - Reading: get_organization_profile(), any active Admin (can_manage_organization). Returns null when
--   nothing is saved yet, and refuses everyone else (42501).
-- - Changing: save_organization_profile(...), only the current Super Admin (is_super_admin), as with
--   set_organization_name. All six values are required and checked here (trimmed):
--     name 1-200 characters on one line (as before); email a valid address, up to 254; description
--     1-1000; address 1-300 on one line; Google Maps link and website http(s) URLs, up to 2048, no spaces.
--   Each value is stored in its own column, exactly as sent: saving a new name changes nothing else.
--   updated_at and updated_by record the save; an organization_management_audit row lists the fields
--   that changed.
-- - get_organization_name and set_organization_name are unchanged (the top bar keeps using them).

begin;

alter table public.organization_settings
  add column email text check (email is null or (
    email = pg_catalog.btrim(email) and pg_catalog.char_length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  add column description text check (description is null or (
    description = pg_catalog.btrim(description) and pg_catalog.char_length(description) between 1 and 1000)),
  add column address text check (address is null or (
    address = pg_catalog.btrim(address) and pg_catalog.char_length(address) between 1 and 300 and address !~ '[[:cntrl:]]')),
  add column maps_url text check (maps_url is null or (
    pg_catalog.char_length(maps_url) <= 2048 and maps_url ~* '^https?://[^[:space:]/?#]+[.][^[:space:]]*$')),
  add column website text check (website is null or (
    pg_catalog.char_length(website) <= 2048 and website ~* '^https?://[^[:space:]/?#]+[.][^[:space:]]*$'));

-- The whole profile, or null when nothing is saved yet. Active Admins only.
create function public.get_organization_profile() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
$$;

-- Saves the whole profile and returns it as stored. Only the Super Admin.
create function public.save_organization_profile(
  p_name text, p_email text, p_description text, p_address text, p_maps_url text, p_website text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_email text := pg_catalog.btrim(coalesce(p_email, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_address text := pg_catalog.btrim(coalesce(p_address, ''));
  v_maps_url text := pg_catalog.btrim(coalesce(p_maps_url, ''));
  v_website text := pg_catalog.btrim(coalesce(p_website, ''));
  url_pattern constant text := '^https?://[^[:space:]/?#]+[.][^[:space:]]*$';
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
  if pg_catalog.char_length(v_address) not between 1 and 300 or v_address ~ '[[:cntrl:]]' then
    raise exception 'Invalid address' using errcode = '22023', hint = 'address';
  end if;
  if pg_catalog.char_length(v_maps_url) not between 1 and 2048 or v_maps_url !~* url_pattern then
    raise exception 'Invalid Google Maps link' using errcode = '22023', hint = 'maps-url';
  end if;
  if pg_catalog.char_length(v_website) not between 1 and 2048 or v_website !~* url_pattern then
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

alter function public.get_organization_profile() owner to postgres;
alter function public.save_organization_profile(text, text, text, text, text, text) owner to postgres;

revoke all on function public.get_organization_profile(), public.save_organization_profile(text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_organization_profile(), public.save_organization_profile(text, text, text, text, text, text)
  to authenticated;

commit;
