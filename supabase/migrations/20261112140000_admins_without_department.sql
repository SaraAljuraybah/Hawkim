-- Admins have no department, division or position, and Request Hawkim no longer asks for a position.
--
-- 1. Request Hawkim: access_requests.job_title becomes optional (null when not given); every existing
--    row stays as it is. submit_access_request() keeps its signature (an older access-requests Edge
--    Function that still sends a position keeps working) and stores null for a missing or blank one.
-- 2. accept_access_request() keeps its signature but creates the Super Admin with no department and
--    no position; p_department is still accepted (so the deployed Edge Function keeps working before
--    and after this migration) and is ignored.
-- 3. Every active Admin's department and position are cleared and their employee_positions rows
--    removed. The old values are saved first in public.admin_profile_backup, so
--    supabase/scripts/rollback_admins_without_department.sql can restore them exactly.
--    (organization_management_audit needs an actor profile, which a migration doesn't have.)
--
-- Triggers that run (as the owner, not an API request), and why they pass:
-- - profiles_guard_super_admin: only refuses API callers and ending the profile; neither happens.
-- - profiles_department_check: Approvers only; an Admin holding Approver stops the migration below.
-- - profiles_active_department: only for a non-null department; skipped.
-- - profiles_department_transfer_guard: refuses a person with SOP work in progress; checked first below
--   with a clear message, so nothing is changed half way.
-- - profiles_sync_positions: the department changes, so their employee_positions rows are deleted
--   (backed up first); with no department nothing is added.
-- - employee_positions_require_one, profiles_require_position (deferred): no department, no position needed.
-- - profiles_require_department (deferred): assert_staff_has_department exempts Admins.
-- Additive apart from the cleared values (restorable) and two functions replaced with the same signature.

begin;

-- ---------- 1. Request Hawkim without Position ----------

alter table public.access_requests alter column job_title drop not null;
alter table public.access_requests drop constraint access_requests_job_title_check;
alter table public.access_requests add constraint access_requests_job_title_check
  check (job_title is null or (job_title = trim(job_title) and char_length(job_title) between 1 and 100));

-- As in 20261110150000_unique_access_request_organization.sql, plus: a missing or blank position is null.
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

-- ---------- 2. The Super Admin from Request Hawkim: no department, no position ----------

-- As in 20261111120000_super_admin.sql, except the profile gets no department and no position.
-- p_department is kept (the signature doesn't change) and ignored.
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

-- ---------- 3. Existing Admins: no department, no position ----------

create table public.admin_profile_backup (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  department_id text,
  "position" text,
  -- Their employee_positions rows: [{department_id, title, sort_order}].
  positions jsonb not null default '[]',
  saved_at timestamptz not null default now()
);
alter table public.admin_profile_backup enable row level security;
-- No policies and no grants: only the rollback script (as the owner) reads it.
revoke all on table public.admin_profile_backup from public, anon, authenticated, service_role;
alter table public.admin_profile_backup owner to postgres;

do $$
declare
  blocked text;
begin
  -- Stop before changing anything if an Admin has SOP work in progress (the department transfer
  -- guard would refuse them) or holds Approver (Approvers must stay in the Quality department).
  select string_agg(p.email, ', ' order by p.email) into blocked
  from public.profiles p
  where p.deleted_at is null
    and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')
    and (p.department_id is not null or p."position" is not null)
    and (exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'approver')
         or (public.sop_responsibilities_in_progress(p.id) ->> 'total')::integer > 0);
  if blocked is not null then
    raise exception 'Admins with SOP work in progress or the Approver role keep their department: %', blocked
      using errcode = '23514', hint = 'admin-department-in-use';
  end if;

  insert into public.admin_profile_backup (profile_id, department_id, "position", positions)
  select p.id, p.department_id, p."position",
         coalesce((select jsonb_agg(jsonb_build_object('department_id', e.department_id, 'title', e.title, 'sort_order', e.sort_order)
                                    order by e.department_id, e.sort_order, e.title)
                   from public.employee_positions e where e.profile_id = p.id), '[]')
  from public.profiles p
  where p.deleted_at is null
    and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin')
    and (p.department_id is not null or p."position" is not null
         or exists (select 1 from public.employee_positions e where e.profile_id = p.id));

  update public.profiles p set department_id = null, "position" = null
  where p.id in (select b.profile_id from public.admin_profile_backup b);
  -- Rows the department change didn't remove (e.g. a position row without a department on the profile).
  delete from public.employee_positions e where e.profile_id in (select b.profile_id from public.admin_profile_backup b);
end;
$$;

commit;
