-- Undoes 20261109120000_department_delete_requires_no_sops.sql: delete_department() and
-- begin_department_file_deletion() return to their 20261107120200 bodies, so a department with SOPs can
-- again be deleted with "Move SOPs to Others" or "Delete associated SOPs". Roll the frontend back first
-- if those options should be offered again. No data changes.
-- Afterwards: supabase migration repair --status reverted 20261109120000
begin;

create or replace function public.begin_department_file_deletion(p_id text,p_expected_updated_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare department public.departments; ids uuid[]; job uuid;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441,1);
  select * into department from public.departments where id=p_id for update;
  if not found then raise exception 'Department unavailable' using errcode='40001'; end if;
  -- Retries use the immutable original job, never a new set of files or a new delete intent.
  if department.deletion_job_id is not null then return department.deletion_job_id; end if;
  if department.removed_at is not null or department.updated_at is distinct from p_expected_updated_at then
    raise exception 'Organization changed; refresh and try again' using errcode='40001';
  end if;
  if exists(select 1 from public.profiles where department_id=p_id and deleted_at is null) then
    raise exception 'Departments with assigned employees cannot be deleted.' using errcode='23503';
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
end; $$;

create or replace function public.delete_department(p_id text,p_sop_action text,p_expected_updated_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare old public.departments; ids uuid[];
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_sop_action='delete' then raise exception 'Permanent file deletion requires the secure cleanup endpoint' using errcode='23514'; end if;
  if p_sop_action is null or p_sop_action not in ('empty','others') then raise exception 'Choose how to handle SOPs' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into old from public.departments where id=p_id and removed_at is null for update;
  if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode='40001'; end if;
  if old.deletion_job_id is not null then raise exception 'Department file cleanup is pending' using errcode='23514'; end if;
  if exists(select 1 from public.profiles where department_id=p_id and deleted_at is null) then
    raise exception 'Departments with assigned employees cannot be deleted.' using errcode='23503';
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
end; $$;

notify pgrst, 'reload schema';
commit;
