-- Undoes 20261112140000_admins_without_department.sql.
-- - Each backed-up Admin gets back their department and position, and their employee_positions rows,
--   when the profile is still active and the department still exists (anything skipped is reported).
-- - submit_access_request() and accept_access_request() get back their earlier bodies
--   (20261110150000_unique_access_request_organization.sql and 20261111120000_super_admin.sql); their
--   signatures, grants, owner, SECURITY DEFINER and search_path never changed.
-- - access_requests.job_title: the original rule (required, 1 to 100 characters) applies again to new
--   requests (NOT VALID). Requests sent without a position in the meantime keep it empty: NOT NULL can't
--   be restored without inventing values, so the column stays nullable.
-- - The backup table is dropped.
begin;

-- ---------- 1. The Admins' departments and positions ----------

do $$
declare
  skipped text;
begin
  select string_agg(p.email, ', ' order by p.email) into skipped
  from public.admin_profile_backup b
  join public.profiles p on p.id = b.profile_id
  where p.deleted_at is not null
     or (b.department_id is not null and not exists (
           select 1 from public.departments d where d.id = b.department_id and d.removed_at is null));
  if skipped is not null then
    raise notice 'Not restored (profile ended or department removed since): %', skipped;
  end if;

  -- profiles_sync_positions adds the main position's row; the transfer guard doesn't run (the old
  -- department is null). An Admin who had a department without any position (as the seed Admin did,
  -- from before positions were required) gets exactly that back: the "a department needs a position"
  -- rule (profiles_require_position) is off only for this update, inside this transaction.
  alter table public.profiles disable trigger profiles_require_position;
  update public.profiles p set department_id = b.department_id, "position" = b."position"
  from public.admin_profile_backup b
  where p.id = b.profile_id and p.deleted_at is null
    and (b.department_id is null or exists (
          select 1 from public.departments d where d.id = b.department_id and d.removed_at is null));
  -- The checks this update queued run now, so the rule can be switched back on (Postgres refuses while
  -- any are waiting); everything after this runs its checks straight away too.
  set constraints all immediate;
  alter table public.profiles enable trigger profiles_require_position;

  -- The other position rows, in their order (the main one is already there).
  insert into public.employee_positions (profile_id, department_id, title, sort_order)
  select b.profile_id, x.department_id, x.title, x.sort_order
  from public.admin_profile_backup b
  join public.profiles p on p.id = b.profile_id and p.deleted_at is null
  cross join lateral jsonb_to_recordset(b.positions) as x(department_id text, title text, sort_order integer)
  where p.department_id = x.department_id
  on conflict (profile_id, department_id, lower(title)) do nothing;
  -- The restored rows keep their saved order (the sync trigger may have given the main one another).
  update public.employee_positions e set sort_order = x.sort_order
  from public.admin_profile_backup b
  cross join lateral jsonb_to_recordset(b.positions) as x(department_id text, title text, sort_order integer)
  where e.profile_id = b.profile_id and e.department_id = x.department_id and lower(e.title) = lower(x.title);
end;
$$;

drop table public.admin_profile_backup;

-- ---------- 2. Request Hawkim: Position required again for new requests ----------

alter table public.access_requests drop constraint access_requests_job_title_check;
alter table public.access_requests add constraint access_requests_job_title_check
  check (job_title is not null and job_title = trim(job_title) and char_length(job_title) between 1 and 100) not valid;

-- As in 20261110150000_unique_access_request_organization.sql.
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

-- ---------- 3. accept_access_request: as in 20261111120000_super_admin.sql ----------

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

  -- The applicant is the organization's initial Super Admin.
  insert into public.super_admin (user_id) values (p_user_id);

  update public.access_requests r
  set status = 'accepted', user_id = p_user_id, decided_at = now()
  where r.id = request.id;
end;
$$;

commit;
