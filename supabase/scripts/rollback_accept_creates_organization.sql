-- Undoes supabase/migrations/20261117130000_accept_creates_organization.sql: one organization per project again
-- (accepting fills the only organization and deployment_onboarded refuses a second one), one lock for
-- everybody, and the functions as they were before it (pg_get_functiondef). Run as the owner (postgres),
-- only while MedCare is the only organization.
begin;

do $$
begin
  if (select count(*) from public.organizations) > 1 then
    raise exception 'More than one organization exists; accepting would no longer create them';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.deployment_onboarded()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from public.organizations o where o.super_admin_id is not null)
    or exists (
      select 1 from public.user_roles r join public.profiles p on p.id = r.user_id and p.deleted_at is null
      where r.role = 'admin'
    );
$function$

;

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
$function$

;

CREATE OR REPLACE FUNCTION public.lock_organization_changes(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- For now one lock for every organization (see the top of 20261116160000_scope_staff_functions.sql).
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.set_row_organization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  org uuid;
  parent_id text;
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'A row can''t move to another organization' using errcode = '42501', hint = 'organization-fixed';
    end if;
    return new;
  end if;

  if tg_nargs = 3 then
    -- Always the parent's organization, whatever was sent.
    parent_id := pg_catalog.to_jsonb(new) ->> tg_argv[1];
    if parent_id is not null then
      execute pg_catalog.format('select p.organization_id from public.%I p where p.id = $1::%s', tg_argv[0], tg_argv[2])
        into org using parent_id;
    end if;
    if org is null then
      raise exception 'The record this belongs to was not found' using errcode = '23503';
    end if;
  elsif public.is_api_user_request() then
    -- A signed-in (or anonymous) API caller: always their own organization.
    org := public.current_organization_id();
  else
    -- The service role or the owner: the organization the function set.
    org := coalesce(new.organization_id, public.only_organization_id());
  end if;

  if org is null then
    raise exception 'An organization is required' using errcode = '23502', hint = 'organization-required';
  end if;
  new.organization_id := org;
  return new;
end;
$function$

;

alter function public.deployment_onboarded() owner to postgres;
revoke all on function public.deployment_onboarded() from public, anon, authenticated, service_role;
grant execute on function public.deployment_onboarded() to service_role;

notify pgrst, 'reload schema';
commit;
