-- Undoes supabase/migrations/20261124120000_departments_always_in_a_division.sql. Run as the owner (postgres).
--
-- Drops the rule "an active department must have a division", and puts back these functions exactly as they were:
--   public.accept_access_request              20261120120000_default_departments.sql
--   public.save_department                    20261120120000_default_departments.sql
--   public.delete_department                  20261120120000_default_departments.sql
--   public.ack_department_file_deletion       20261116130000_conflict_without_retry.sql
-- (new organizations again get their two default departments without a division, an edit may again leave a
-- department without one, and deleting a department clears its division again).
--
-- The data stays: the divisions created by the migration (dhai's, and those of organizations accepted since) and the
-- departments in them stay as they are; they are valid without the migration too. Departments deleted while it was in
-- place keep their division.
--
-- Kept on purpose: divisions_organization_name_unique (division names unique per organization) and
-- divisions_name_not_blank. The global divisions_name_unique (one name across all organizations) is NOT restored: it
-- is itself a multi-tenant bug, and organizations may share division names by now.
begin;

alter table public.departments drop constraint if exists departments_active_division_required;

do $$
begin
  raise notice 'rollback_departments_always_in_a_division: divisions_name_unique (one division name across all organizations) is not restored; divisions_organization_name_unique and divisions_name_not_blank stay';
end;
$$;

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

  -- Its two default departments (20261120120000: protected, marked with their system keys). No division, and no
  -- regulatory guideline: the organization starts with none, and an Admin adds its own.
  insert into public.departments (id, name, initials, description, is_quality, requires_compliance_check, organization_id, system_key) values
    ('department-' || gen_random_uuid()::text, 'Pharmacovigilance', 'PV', '', false, true, v_organization, 'pharmacovigilance'),
    ('department-' || gen_random_uuid()::text, 'Quality Assurance', 'QA', '', true, false, v_organization, 'quality-assurance');

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
$function$;

CREATE OR REPLACE FUNCTION public.save_department(p_id text, p_name text, p_initials text, p_description text, p_division_id text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_email text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target text; old public.departments; v_email text := nullif(btrim(p_email), '');
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  perform public.lock_organization_changes(public.current_organization_id());
  if p_name is null or length(btrim(p_name)) not between 1 and 60
    or p_initials is null or btrim(p_initials) !~ '^[A-Za-z]{2,3}$'
    or length(btrim(coalesce(p_description,''))) > 200
    or (v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')) then
    raise exception 'Invalid department fields' using errcode='23514';
  end if;
  if p_division_id is not null and not exists(select 1 from public.divisions where id=p_division_id and organization_id = public.current_organization_id()
    and is_active is not false for share) then
    raise exception 'Select an active division' using errcode='23514';
  end if;
  -- New departments require a division; legacy unassigned departments can stay unassigned.
  if p_id is null and p_division_id is null then raise exception 'Select a division' using errcode='23514'; end if;
  if exists(select 1 from public.departments where organization_id = public.current_organization_id() and removed_at is null and id is distinct from p_id
    and (lower(btrim(name))=lower(btrim(p_name)) or upper(btrim(initials))=upper(btrim(p_initials)))) then
    raise exception 'Department name or initials already exists' using errcode='23505';
  end if;
  if p_id is null then
    -- Email and description are required (blank counts as empty); checked last, so the other refusals stay as they were.
    if nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'Enter an email address' using errcode='23514'; end if;
    if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Enter a description' using errcode='23514'; end if;
    target := 'department-' || gen_random_uuid()::text;
    insert into public.departments(id,name,initials,description,division_id,email)
      values(target,btrim(p_name),upper(btrim(p_initials)),btrim(coalesce(p_description,'')),p_division_id,v_email);
  else
    select * into old from public.departments where id=p_id and organization_id = public.current_organization_id() and removed_at is null for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict'; end if;
    -- 20261120120000: a default department keeps its name (and the initials generated from it).
    if old.system_key is not null and (btrim(p_name) is distinct from old.name or upper(btrim(p_initials)) is distinct from old.initials) then
      raise exception 'A default department''s name can''t be changed' using errcode = '23514', hint = 'default-department';
    end if;
    -- Email and description are required (blank counts as empty); checked last, so the other refusals stay as they were.
    if nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'Enter an email address' using errcode='23514'; end if;
    if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Enter a description' using errcode='23514'; end if;
    target := p_id;
    update public.departments set name=btrim(p_name),initials=upper(btrim(p_initials)),description=btrim(coalesce(p_description,'')),
      division_id=p_division_id,email=v_email,updated_at=clock_timestamp() where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-department',target);
  return target;
end; $function$;

CREATE OR REPLACE FUNCTION public.delete_department(p_id text, p_sop_action text, p_expected_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old public.departments; ids uuid[];
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_sop_action='delete' then raise exception 'Permanent file deletion requires the secure cleanup endpoint' using errcode='23514'; end if;
  if p_sop_action is null or p_sop_action not in ('empty','others') then raise exception 'Choose how to handle SOPs' using errcode='23514'; end if;
  perform public.lock_organization_changes(public.current_organization_id());
  select * into old from public.departments where id=p_id and organization_id = public.current_organization_id() and removed_at is null for update;
  if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict'; end if;
  -- 20261120120000: the organization's default departments stay.
  if old.system_key is not null then
    raise exception 'Default departments cannot be deleted.' using errcode = 'P0001', hint = 'default-department';
  end if;
  if old.deletion_job_id is not null then raise exception 'Department file cleanup is pending' using errcode='23514'; end if;
  if exists(select 1 from public.profiles where department_id=p_id and deleted_at is null) then
    raise exception 'Departments with assigned employees cannot be deleted.' using errcode='23503';
  end if;
  -- New: any SOP that still exists (deleted_at is null), in any status, blocks the deletion.
  -- "Deleted SOP" records left by an earlier "Delete associated SOPs" have deleted_at set and don't count.
  if exists(select 1 from public.sops where department_id=p_id and deleted_at is null) then
    raise exception 'Departments with SOPs cannot be deleted.' using errcode='23503';
  end if;
  -- Row locks also serialize review/compliance RPCs (which lock their SOP first).
  perform 1 from public.sops where department_id=p_id order by id for update;
  select array_agg(id) into ids from public.sops where department_id=p_id and deleted_at is null and directory_group='department';
  if ids is not null and p_sop_action='empty' then raise exception 'Department has SOPs; choose Delete or Move to Others' using errcode='23503'; end if;
  if exists(select 1 from public.sops where id=any(ids) and status in ('in-review','in-approval'))
    or exists(select 1 from public.review_rounds where sop_id=any(ids) and status='open')
    or exists(select 1 from public.compliance_checks where sop_id=any(ids) and status='running') then
    raise exception 'Settle active reviews and compliance checks before deleting this department.' using errcode='23514';
  end if;
  if p_sop_action='others' then
    -- The department is a historical tombstone, not an active directory assignment.
    -- Retain its FK for confidentiality and workflow evidence; do not invent a department.
    update public.sops set directory_group='others',updated_at=now() where id=any(ids);
  end if;
  update public.departments set removed_at=now(),division_id=null,updated_at=clock_timestamp() where id=p_id;
  insert into public.organization_management_audit(actor_id,action,entity_id,details)
    values(auth.uid(),'delete-department',p_id,jsonb_build_object('sopAction',p_sop_action,'sopIds',coalesce(to_jsonb(ids),'[]')));
end; $function$;

CREATE OR REPLACE FUNCTION public.ack_department_file_deletion(p_job_id uuid, p_lease_token uuid, p_deleted_paths text[], p_failed boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job public.department_file_deletions; remaining integer;
begin
  if p_failed is null or p_deleted_paths is null then raise exception 'Explicit cleanup result required' using errcode='23514'; end if;
  select * into job from public.department_file_deletions where id=p_job_id for update;
  if not found or p_lease_token is null or job.lease_until is null or job.lease_token is distinct from p_lease_token or job.lease_until <= clock_timestamp() then
    raise exception 'Deletion lease changed' using errcode = 'P0001', hint = 'conflict';
  end if;
  if exists(select 1 from unnest(p_deleted_paths) path where not exists(
    select 1 from public.department_file_deletion_items where job_id=p_job_id and storage_path=path)) then
    raise exception 'Unexpected deletion path' using errcode='23514';
  end if;
  -- A worker cannot mark a file deleted while Storage still holds it.
  if exists(select 1 from public.department_file_deletion_items i where i.job_id=p_job_id and i.storage_path=any(p_deleted_paths)
    and exists(select 1 from storage.objects o where o.bucket_id=i.bucket_id and o.name=i.storage_path)) then
    raise exception 'Storage object still present' using errcode='23514';
  end if;
  update public.department_file_deletion_items set deleted_at=coalesce(deleted_at,now())
    where job_id=p_job_id and storage_path=any(p_deleted_paths);
  select count(*) into remaining from public.department_file_deletion_items where job_id=p_job_id and deleted_at is null;
  if remaining=0 and not p_failed then
    -- Finalization is intentionally after verified Storage absence, in its own transaction.
    perform 1 from public.departments where id=job.department_id for update;
    if exists(select 1 from public.profiles where department_id=job.department_id and deleted_at is null) then
      raise exception 'Employee assignment conflict' using errcode='23503';
    end if;
    update public.departments set removed_at=now(),division_id=null,updated_at=clock_timestamp() where id=job.department_id;
    update public.department_file_deletions set state='completed',completed_at=now(),lease_token=null,lease_until=null,error_code=null where id=p_job_id;
    insert into public.organization_management_audit(actor_id,action,entity_id,details)
      values(job.requested_by,'department-file-deletion-completed',job.department_id,jsonb_build_object('jobId',p_job_id,
        'fileCount',(select count(*) from public.department_file_deletion_items where job_id=p_job_id)));
    return 'completed';
  end if;
  update public.department_file_deletions set state=case when p_failed then 'failed' else 'pending' end,
    lease_token=null,lease_until=null,error_code=case when p_failed then 'storage-cleanup-incomplete' end where id=p_job_id;
  return case when p_failed then 'failed' else 'pending' end;
end; $function$;

alter function public.accept_access_request(uuid, text, uuid, text) owner to postgres;
alter function public.save_department(text, text, text, text, text, timestamp with time zone, text) owner to postgres;
alter function public.delete_department(text, text, timestamp with time zone) owner to postgres;
alter function public.ack_department_file_deletion(uuid, uuid, text[], boolean) owner to postgres;

notify pgrst, 'reload schema';
commit;
