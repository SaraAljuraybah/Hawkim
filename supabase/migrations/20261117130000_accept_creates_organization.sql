-- Multi-tenant, step 13: each accepted Request Hawkim creates its own organization.
--
-- 1. accept_access_request (the access-requests Edge Function, service role) creates a new organization
--    for the request: its name and Organization Profile from the request (a profile value the profile
--    refuses is left empty; the name's control characters become spaces), its two starting departments
--    and the applicant, who becomes its Super Admin (an Admin, without a department or position):
--      Pharmacovigilance (PV)    requires_compliance_check = true,  is_quality = false
--      Quality Assurance (QA)    requires_compliance_check = false, is_quality = true
--    Departments added later keep requires_compliance_check = false by default. One account belongs to
--    one organization: a person who already has a profile (in any organization, active or not) can't be
--    accepted (email_in_use). The request is accepted into the new organization (access_requests and
--    organizations.access_request_id).
-- 2. deployment_onboarded() is dropped: a project accepts any number of organizations.
-- 3. One lock per organization: every function takes it through lock_organization_changes (checked
--    below), which now locks only the given organization's changes, so organizations no longer wait for
--    each other.
-- 4. set_row_organization: a row that starts an organization's data, inserted by the SERVICE ROLE without
--    an organization, is refused even while there is one organization (every service function sets it).
--    The owner (migrations, seed.sql, maintenance) still gets the only organization when there is exactly
--    one; with two or more it must say which.
--
-- Undo: supabase/scripts/rollback_accept_creates_organization.sql

begin;

-- ---------- 1. Accepting creates the organization ----------

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
  v_name text;
  v_organization uuid;
begin
  -- p_department: sent by older Edge Functions; unused (an Admin has no department).
  request := public.lock_pending_access_request(p_id, p_token_hash);

  -- One account belongs to one organization: an account that has a profile anywhere can't start another.
  if exists (select 1 from public.profiles p where p.email = request.email and p.deleted_at is null)
     or exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'email_in_use' using errcode = 'P0001';
  end if;

  v_name := pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(request.organization, ''), '[[:cntrl:]]+', ' ', 'g')), 200);
  if v_name = '' then
    raise exception 'invalid_organization_details' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, access_request_id) values (v_name, request.id) returning id into v_organization;
  perform public.lock_organization_changes(v_organization);

  -- The Organization Profile from the request. In its own block: a value the profile refuses is left empty,
  -- and the request is still accepted.
  begin
    update public.organizations o set
      email = request.organization_email, description = request.organization_description,
      address = request.organization_address, maps_url = request.organization_maps_url,
      website = request.organization_website, updated_at = pg_catalog.now()
    where o.id = v_organization;
  exception when integrity_constraint_violation or data_exception then
    raise notice 'accept_access_request: the organization details of request % were not copied (%)', request.id, sqlerrm;
  end;

  -- Its starting departments.
  insert into public.departments (id, name, initials, description, is_quality, requires_compliance_check, organization_id) values
    ('department-' || gen_random_uuid()::text, 'Pharmacovigilance', 'PV', '', false, true, v_organization),
    ('department-' || gen_random_uuid()::text, 'Quality Assurance', 'QA', '', true, false, v_organization);

  -- The applicant: an Admin, with no department and no position (as in 20261112140000).
  words := regexp_split_to_array(request.contact_name, '\s+');
  initials := upper(case
    when array_length(words, 1) >= 2 then left(words[1], 1) || left(words[array_length(words, 1)], 1)
    else left(words[1], 2)
  end);
  insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id)
  values (p_user_id, request.contact_name, request.email, initials, null, request.phone, null, v_organization);
  insert into public.user_roles (user_id, role) values (p_user_id, 'admin');

  -- The organization's Super Admin.
  update public.organizations o set super_admin_id = p_user_id, super_admin_assigned_at = now() where o.id = v_organization;

  update public.access_requests r
  set status = 'accepted', user_id = p_user_id, decided_at = now(), organization_id = v_organization
  where r.id = request.id;
end;
$$;

-- ---------- 2. Any number of organizations ----------

drop function public.deployment_onboarded();

-- ---------- 3. One lock per organization ----------

create or replace function public.lock_organization_changes(p_organization_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- The changes of one organization happen one at a time; other organizations don't wait.
  perform pg_catalog.pg_advisory_xact_lock(72441, pg_catalog.hashtext(coalesce(p_organization_id::text, '')));
end;
$$;

do $$
declare left_over text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into left_over
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname <> 'lock_organization_changes'
    and p.prosrc ~ 'pg_advisory_xact_lock\s*\(\s*72441';
  if left_over is not null then
    raise exception 'These functions still take the one lock for everybody: %', left_over;
  end if;
end;
$$;

-- ---------- 4. The service role always names the organization ----------

create or replace function public.set_row_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
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
    -- The service role or the owner: the organization the function set. Only the owner (migrations, the
    -- seed, maintenance) gets the only organization when there is exactly one.
    org := new.organization_id;
    if org is null and coalesce(pg_catalog.current_setting('role', true), '') <> 'service_role' then
      org := public.only_organization_id();
    end if;
  end if;

  if org is null then
    raise exception 'An organization is required' using errcode = '23502', hint = 'organization-required';
  end if;
  new.organization_id := org;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
