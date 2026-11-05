-- Forward security change from observed catalog definitions; NOT the missing original migration.
-- Approved decision: access-request acceptance/rejection requires an active Admin user session.
-- Existing service-only external handlers must forward that session; production stays blocked until
-- their source is recovered/reconciled, updated and tested. Submission/read helpers stay service-only.
-- Fail closed on a fresh checkout that has not established the approved onboarding baseline.
begin;
do $$ begin
  if to_regprocedure('public.accept_access_request(uuid,text,uuid,text)') is null
    or to_regprocedure('public.reject_access_request(uuid,text)') is null then
    raise exception 'Missing access_requests baseline; recover original source or approve catalog-baseline adoption before migration';
  end if;
end $$;
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
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441,1);

  request := public.lock_pending_access_request(p_id, p_token_hash);
  -- Approval creates a NEW matching Auth/profile identity; it cannot repurpose an existing employee.
  if exists(select 1 from public.profiles where id=p_user_id)
    or not exists(select 1 from auth.users u where u.id=p_user_id and lower(u.email)=request.email
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
    raise exception 'Organization changed; refresh and try again' using errcode='40001';
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

  update public.access_requests r
  set status = 'accepted', user_id = p_user_id, decided_at = now()
  where r.id = request.id;
end;
$function$
;
alter function public.accept_access_request(uuid,text,uuid,text) owner to postgres;
revoke all on function public.accept_access_request(uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.accept_access_request(uuid,text,uuid,text) to authenticated;

CREATE OR REPLACE FUNCTION public.reject_access_request(p_id uuid, p_token_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  request public.access_requests;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441,1);

  request := public.lock_pending_access_request(p_id, p_token_hash);
  update public.access_requests r set status = 'rejected', decided_at = now() where r.id = request.id;
end;
$function$
;
alter function public.reject_access_request(uuid,text) owner to postgres;
revoke all on function public.reject_access_request(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.reject_access_request(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
