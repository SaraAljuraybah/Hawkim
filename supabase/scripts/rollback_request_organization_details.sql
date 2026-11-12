-- Undoes 20261115120000_request_organization_details.sql: puts back the earlier submit_access_request,
-- get_access_request, accept_access_request and save_organization_profile, and drops the five
-- access_requests columns.
--
-- !! AFTER RUNNING THIS, REDEPLOY THE PREVIOUS access-requests EDGE FUNCTION RIGHT AWAY !!
-- The current function calls the 13-parameter submit_access_request, which this script removes: until the
-- previous function is deployed, every new Request Hawkim fails ("could not be sent"). The review page and
-- Accept/Reject keep working in the meantime.
-- The previous function is the one before the commit
-- "feat: check and store organization details in the access-requests Edge Function"
-- (find it with: git log --oneline -- supabase/functions/access-requests). Deploy it in ONE of two ways:
--   a) CLI, from a checkout of that earlier commit (your working copy stays as it is):
--        git worktree add ../hawkim-previous <commit before that one>
--        cd ../hawkim-previous
--        npx supabase functions deploy access-requests --no-verify-jwt
--        cd - && git worktree remove ../hawkim-previous
--   b) Dashboard: print the earlier single-file copy with
--        git show <commit before that one>:supabase/functions/access-requests/access-requests-single-file.ts
--      then Dashboard → Edge Functions → access-requests → paste it, deploy, and keep JWT verification OFF.
-- The website may keep its new Request Hawkim form: the previous function ignores the extra fields.
--
-- Data loss: the organization details of requests sent after the migration (the five access_requests columns).
-- Kept: what is in organization_settings (values copied from a request or saved since are valid profile
-- values). After the rollback every profile value is required again and links may be http:// again, so the
-- Super Admin fills in an empty Website, Address or Google Maps link at the next save.
begin;

-- save_organization_profile as in 20261113150000_organization_profile.sql.
create or replace function public.save_organization_profile(
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

-- accept_access_request as in 20261112140000_admins_without_department.sql.
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

  update public.access_requests r
  set status = 'accepted', user_id = p_user_id, decided_at = now()
  where r.id = request.id;
end;
$$;

-- get_access_request as in 20261106130000_access_requests.sql.
drop function public.get_access_request(uuid, text);
create function public.get_access_request(p_id uuid, p_token_hash text)
returns table (
  id uuid, organization text, contact_name text, job_title text, email text, phone text,
  approx_users integer, message text, status public.access_request_status, created_at timestamptz,
  decided_at timestamptz, expired boolean, account_exists boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.organization, r.contact_name, r.job_title, r.email, r.phone, r.approx_users, r.message,
         r.status, r.created_at, r.decided_at,
         r.review_expires_at < now() as expired,
         exists (select 1 from public.profiles p where p.email = r.email and p.deleted_at is null) as account_exists
  from public.access_requests r
  where r.id = p_id and r.review_token_hash = p_token_hash;
$$;

-- submit_access_request as in 20261112140000_admins_without_department.sql.
drop function public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text);
create function public.submit_access_request(
  p_organization text, p_contact_name text, p_job_title text, p_email text, p_phone text,
  p_approx_users integer, p_message text, p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(p_email));
  -- The organization name as compared: lower case, trimmed, inner spaces collapsed (as in the index).
  organization_key text := lower(regexp_replace(trim(p_organization), '\s+', ' ', 'g'));
  recent integer;
  new_id uuid;
  violated text;
begin
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
      (organization, contact_name, job_title, email, phone, approx_users, message, review_token_hash, review_expires_at)
    values
      (trim(p_organization), trim(p_contact_name), nullif(trim(coalesce(p_job_title, '')), ''), normalized, p_phone, p_approx_users,
       trim(coalesce(p_message, '')), p_token_hash, now() + interval '14 days')
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

alter function public.submit_access_request(text, text, text, text, text, integer, text, text) owner to postgres;
alter function public.get_access_request(uuid, text) owner to postgres;
revoke all on function public.submit_access_request(text, text, text, text, text, integer, text, text),
  public.get_access_request(uuid, text) from public, anon, authenticated;
grant execute on function public.submit_access_request(text, text, text, text, text, integer, text, text),
  public.get_access_request(uuid, text) to service_role;

alter table public.access_requests
  drop column organization_email,
  drop column organization_address,
  drop column organization_maps_url,
  drop column organization_website,
  drop column organization_description;

notify pgrst, 'reload schema';
commit;
