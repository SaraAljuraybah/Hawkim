-- Undoes the 2026-11-20 release, newest first, back to the schema of 20261119140000:
--   20261120140000_user_requests          (drops user_requests and its three functions; EXPORT the requests first)
--   20261120130000_guideline_availability (drops guideline_availability)
--   20261120120000_default_departments    (restores the four functions as they were (pg_get_functiondef), drops the
--                                          guard trigger, its function and departments.system_key)
-- Run as the owner (postgres), in one transaction. Checked by restoring a local database and comparing its public
-- schema with one at 20261119140000 (docs/release-2026-11-20.md). The audit rows written by decide_user_request
-- ('decide-request' in organization_management_audit) are left as they are: they are history, not schema.
begin;

-- ---------- 20261120140000_user_requests ----------
drop function public.decide_user_request(uuid, text);
drop function public.cancel_user_request(uuid);
drop function public.submit_user_request(text, text, text);
drop table public.user_requests;

-- ---------- 20261120130000_guideline_availability ----------
drop function public.guideline_availability();

-- ---------- 20261120120000_default_departments ----------
drop trigger departments_default_guard on public.departments;
drop function public.guard_default_department();

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
$function$
;

CREATE OR REPLACE FUNCTION public.begin_department_file_deletion(p_id text, p_expected_updated_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare department public.departments; ids uuid[]; job uuid;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  perform public.lock_organization_changes(public.current_organization_id());
  select * into department from public.departments where id=p_id and organization_id = public.current_organization_id() for update;
  if not found then raise exception 'Department unavailable' using errcode = 'P0001', hint = 'conflict'; end if;
  -- Retries use the immutable original job, never a new set of files or a new delete intent.
  if department.deletion_job_id is not null then return department.deletion_job_id; end if;
  if department.removed_at is not null or department.updated_at is distinct from p_expected_updated_at then
    raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict';
  end if;
  if exists(select 1 from public.profiles where department_id=p_id and deleted_at is null) then
    raise exception 'Departments with assigned employees cannot be deleted.' using errcode='23503';
  end if;
  -- New: any SOP that still exists (deleted_at is null), in any status, blocks the deletion.
  -- "Deleted SOP" records left by an earlier "Delete associated SOPs" have deleted_at set and don't count.
  if exists(select 1 from public.sops where department_id=p_id and deleted_at is null) then
    raise exception 'Departments with SOPs cannot be deleted.' using errcode='23503';
  end if;
  perform 1 from public.sops where department_id=p_id order by id for update;
  select coalesce(array_agg(id),'{}') into ids from public.sops
    where department_id=p_id and deleted_at is null and directory_group='department';
  if exists(select 1 from public.sops where id=any(ids) and status in ('in-review','in-approval'))
    or exists(select 1 from public.review_rounds where sop_id=any(ids) and status='open')
    or exists(select 1 from public.compliance_checks where sop_id=any(ids) and status='running') then
    raise exception 'Settle active reviews and compliance checks before deleting this department.' using errcode='23514';
  end if;
  insert into public.department_file_deletions(department_id,requested_by,sop_ids)
    values(p_id,auth.uid(),ids) returning id into job;
  -- Every version's file, deleted versions included; never a NULL, blank or repeated path.
  insert into public.department_file_deletion_items(job_id,bucket_id,storage_path)
    select distinct job,'sop-files',v.storage_path from public.sop_versions v
    where v.sop_id=any(ids) and v.storage_path is not null and btrim(v.storage_path) <> ''
  on conflict do nothing;
  -- Keep relational decision/identity/timestamp evidence needed by existing FKs, removing
  -- document descriptions, review prose, filenames and derived compliance content.
  delete from public.compliance_findings where check_id in (select id from public.compliance_checks where sop_id=any(ids));
  update public.compliance_checks set metadata='{}',error_message=null where sop_id=any(ids);
  update public.sop_comments set text='Removed with SOP deletion' where sop_id=any(ids);
  update public.review_requests set decline_reason=case when decline_reason is not null then 'Removed with SOP deletion' end,
    removal_reason=case when removal_reason is not null then 'Removed with SOP deletion' end where sop_id=any(ids);
  update public.timeline_events set note=null where sop_id=any(ids);
  update public.sop_versions set file_name='deleted',deleted_at=coalesce(deleted_at,now()),deleted_by=coalesce(deleted_by,auth.uid()) where sop_id=any(ids);
  update public.sops set title='Deleted SOP',description='',deleted_at=now(),updated_at=now() where id=any(ids);
  update public.departments set deletion_job_id=job,updated_at=clock_timestamp() where id=p_id;
  insert into public.organization_management_audit(actor_id,action,entity_id,details)
    values(auth.uid(),'department-file-deletion-requested',p_id,jsonb_build_object('jobId',job,'sopIds',ids));
  return job;
end; $function$
;

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
end; $function$
;

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
    -- Email and description are required (blank counts as empty); checked last, so the other refusals stay as they were.
    if nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'Enter an email address' using errcode='23514'; end if;
    if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Enter a description' using errcode='23514'; end if;
    target := p_id;
    update public.departments set name=btrim(p_name),initials=upper(btrim(p_initials)),description=btrim(coalesce(p_description,'')),
      division_id=p_division_id,email=v_email,updated_at=clock_timestamp() where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-department',target);
  return target;
end; $function$
;

alter table public.departments drop constraint departments_organization_id_system_key_key;
alter table public.departments drop constraint departments_system_key_check;
alter table public.departments drop column system_key;

commit;
