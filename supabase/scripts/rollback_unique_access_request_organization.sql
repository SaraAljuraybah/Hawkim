-- Undoes 20261110150000_unique_access_request_organization.sql: Request Hawkim accepts a request
-- whatever its organization name again. The index is dropped and submit_access_request() gets back
-- its body from 20261106130000_access_requests.sql (the only earlier definition); its signature,
-- grants, owner, SECURITY DEFINER and search_path were never changed. No data is lost.
begin;

drop index if exists public.access_requests_organization_unique;

-- Store a new request. At most 3 requests per email address in 24 hours.
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
  recent integer;
  new_id uuid;
begin
  select count(*) into recent from public.access_requests r
  where r.email = normalized and r.created_at > now() - interval '24 hours';
  if recent >= 3 then
    raise exception 'too_many_requests' using errcode = 'P0001';
  end if;

  insert into public.access_requests
    (organization, contact_name, job_title, email, phone, approx_users, message, review_token_hash, review_expires_at)
  values
    (trim(p_organization), trim(p_contact_name), trim(p_job_title), normalized, p_phone, p_approx_users,
     trim(coalesce(p_message, '')), p_token_hash, now() + interval '14 days')
  returning id into new_id;
  return new_id;
end;
$$;

commit;
