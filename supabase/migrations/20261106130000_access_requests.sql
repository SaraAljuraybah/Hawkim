-- Requests to use Hawkim ("Request Hawkim" on the website), reviewed by the Hawkim team.
--
-- The website's form calls the access-requests Edge Function, which stores the request here and
-- emails the team a review link with a secret token (only its SHA-256 is stored). Accepting creates
-- the requester's account as the organization's Admin; the Admin then invites the other users.
-- Only the service role (Edge Functions) uses this table and these functions; the browser has no
-- access to them.

create type public.access_request_status as enum ('pending', 'accepted', 'rejected');

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  organization text not null check (organization = trim(organization) and char_length(organization) between 1 and 200),
  contact_name text not null check (contact_name = trim(contact_name) and char_length(contact_name) between 1 and 100),
  job_title text not null check (job_title = trim(job_title) and char_length(job_title) between 1 and 100),
  email text not null check (email = lower(trim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and char_length(email) <= 254),
  -- The same format as profiles.phone, so an accepted request can fill the Admin's profile.
  phone text not null check (phone ~ '^\+9665[0-9]{8}$'),
  approx_users integer not null check (approx_users between 1 and 100000),
  message text not null default '' check (message = trim(message) and char_length(message) <= 2000),
  status public.access_request_status not null default 'pending',
  -- SHA-256 (hex) of the secret in the review link; the secret itself is never stored.
  review_token_hash text not null check (review_token_hash ~ '^[0-9a-f]{64}$'),
  review_expires_at timestamptz not null,
  -- The account created when the request was accepted.
  user_id uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index access_requests_email_created on public.access_requests (email, created_at);

alter table public.access_requests enable row level security;
-- No policies: nobody reads or writes the table directly except the service role.

-- ---------- Functions for the access-requests Edge Function ----------

-- Store a new request. At most 3 requests per email address in 24 hours.
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

-- A request as shown on the review page, when the review link's token matches. Includes whether
-- the review link has expired and whether the email already has an active Hawkim profile.
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

-- The request to decide, locked; raises when the token is wrong, the request was already decided
-- or the review link has expired.
create function public.lock_pending_access_request(p_id uuid, p_token_hash text)
returns public.access_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.access_requests;
begin
  select * into request from public.access_requests r
  where r.id = p_id and r.review_token_hash = p_token_hash
  for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  if request.status <> 'pending' then
    raise exception 'request_already_decided' using errcode = 'P0001';
  end if;
  if request.review_expires_at < now() then
    raise exception 'review_link_expired' using errcode = 'P0001';
  end if;
  return request;
end;
$$;

-- Accept a request: the account (p_user_id, created by the Edge Function in Supabase Auth) gets an
-- active profile in p_department and the Admin role, filled from the request.
create function public.accept_access_request(p_id uuid, p_token_hash text, p_user_id uuid, p_department text)
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

  update public.access_requests r
  set status = 'accepted', user_id = p_user_id, decided_at = now()
  where r.id = request.id;
end;
$$;

-- Reject a request.
create function public.reject_access_request(p_id uuid, p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.access_requests;
begin
  request := public.lock_pending_access_request(p_id, p_token_hash);
  update public.access_requests r set status = 'rejected', decided_at = now() where r.id = request.id;
end;
$$;

revoke all on table public.access_requests from public, anon, authenticated;
revoke execute on function public.submit_access_request(text, text, text, text, text, integer, text, text) from public, anon, authenticated;
revoke execute on function public.get_access_request(uuid, text) from public, anon, authenticated;
revoke execute on function public.lock_pending_access_request(uuid, text) from public, anon, authenticated;
revoke execute on function public.accept_access_request(uuid, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.reject_access_request(uuid, text) from public, anon, authenticated;
grant select, insert, update on table public.access_requests to service_role;
grant execute on function public.submit_access_request(text, text, text, text, text, integer, text, text) to service_role;
grant execute on function public.get_access_request(uuid, text) to service_role;
grant execute on function public.lock_pending_access_request(uuid, text) to service_role;
grant execute on function public.accept_access_request(uuid, text, uuid, text) to service_role;
grant execute on function public.reject_access_request(uuid, text) to service_role;
