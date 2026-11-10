-- Request Hawkim: one request per organization. A new request is refused (organization_taken) when a
-- pending or accepted request already has the same organization name, ignoring case, surrounding
-- spaces and repeated inner spaces. Rejected requests don't count, so a rejected organization can
-- apply again.
--
--  * submit_access_request() checks every pending and accepted request, old ones included.
--  * A partial unique index enforces the same rule for requests from this migration on, so two
--    submissions at the same moment can't both get through; its violation becomes organization_taken.
--    Requests from before 2026-11-10 15:00 UTC (this migration) are left out of the index: the live
--    table already has a pending/accepted name more than once, and existing rows are not changed.
--
-- Additive: one new index; submit_access_request() is replaced with the same signature, grants,
-- owner, SECURITY DEFINER and search_path. Its body is 20261106130000_access_requests.sql's (the only
-- definition) plus the organization check. No table, row or other function changes.
-- Undo: supabase/scripts/rollback_unique_access_request_organization.sql

begin;

create unique index access_requests_organization_unique
  on public.access_requests (lower(regexp_replace(trim(organization), '\s+', ' ', 'g')))
  where status in ('pending', 'accepted') and created_at >= timestamptz '2026-11-10 15:00:00+00';

-- Store a new request. At most 3 requests per email address in 24 hours; one pending or accepted
-- request per organization name.
create or replace function public.submit_access_request(
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
      (trim(p_organization), trim(p_contact_name), trim(p_job_title), normalized, p_phone, p_approx_users,
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

commit;
