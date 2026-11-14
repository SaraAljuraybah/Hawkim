-- Undoes supabase/migrations/20261116130000_conflict_without_retry.sql: the functions as they were before it
-- (SQLSTATE 40001 for a conflict). Run as the owner (postgres).
begin;

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
    raise exception 'Deletion lease changed' using errcode='40001';
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
end; $function$
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

CREATE OR REPLACE FUNCTION public.claim_department_file_deletion(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job public.department_file_deletions; token uuid; files jsonb;
begin
  select * into job from public.department_file_deletions where id=p_job_id for update;
  if not found then raise exception 'Deletion job unavailable' using errcode='40001'; end if;
  if job.state='completed' then return jsonb_build_object('state','completed'); end if;
  if job.lease_until > clock_timestamp() then return jsonb_build_object('state','busy'); end if;
  -- Re-check ownership before issuing deletion instructions; never remove shared active files.
  if exists(select 1 from public.department_file_deletion_items i join public.sop_versions v on v.storage_path=i.storage_path
    where i.job_id=p_job_id and not (v.sop_id=any(job.sop_ids))) then
    raise exception 'File ownership conflict' using errcode='23514';
  end if;
  token:=gen_random_uuid();
  update public.department_file_deletions set state='processing',attempts=attempts+1,lease_token=token,
    lease_until=clock_timestamp()+interval '5 minutes',error_code=null where id=p_job_id;
  select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'path',storage_path)),'[]') into files
    from (select bucket_id,storage_path from public.department_file_deletion_items
      where job_id=p_job_id and deleted_at is null order by storage_path limit 100) batch;
  return jsonb_build_object('state','processing','leaseToken',token,'files',files);
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
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into old from public.departments where id=p_id and removed_at is null for update;
  if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode='40001'; end if;
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

CREATE OR REPLACE FUNCTION public.delete_division(p_id text, p_expected_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old public.divisions;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into old from public.divisions where id=p_id and is_active is not false for update;
  if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = '40001'; end if;
  if exists(select 1 from public.departments where division_id=p_id and removed_at is null) then
    raise exception 'Divisions with assigned departments cannot be deleted.' using errcode='23503';
  end if;
  update public.divisions set is_active=false,updated_at=clock_timestamp() where id=p_id;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'delete-division',p_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_department_file_deletion(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  select jsonb_build_object('id',j.id,'state',j.state,'attempts',j.attempts,'errorCode',j.error_code,
    'totalFiles',(select count(*) from public.department_file_deletion_items where job_id=j.id),
    'deletedFiles',(select count(*) from public.department_file_deletion_items where job_id=j.id and deleted_at is not null))
    into result from public.department_file_deletions j where j.id=p_job_id;
  if result is null then raise exception 'Deletion job unavailable' using errcode='40001'; end if;
  return result;
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
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if p_name is null or length(btrim(p_name)) not between 1 and 60
    or p_initials is null or btrim(p_initials) !~ '^[A-Za-z]{2,3}$'
    or length(btrim(coalesce(p_description,''))) > 200
    or (v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')) then
    raise exception 'Invalid department fields' using errcode='23514';
  end if;
  if p_division_id is not null and not exists(select 1 from public.divisions where id=p_division_id and is_active is not false for share) then
    raise exception 'Select an active division' using errcode='23514';
  end if;
  -- New departments require a division; legacy unassigned departments can stay unassigned.
  if p_id is null and p_division_id is null then raise exception 'Select a division' using errcode='23514'; end if;
  if exists(select 1 from public.departments where removed_at is null and id is distinct from p_id
    and (lower(btrim(name))=lower(btrim(p_name)) or upper(btrim(initials))=upper(btrim(p_initials)))) then
    raise exception 'Department name or initials already exists' using errcode='23505';
  end if;
  if p_id is null then
    target := 'department-' || gen_random_uuid()::text;
    insert into public.departments(id,name,initials,description,division_id,email)
      values(target,btrim(p_name),upper(btrim(p_initials)),btrim(coalesce(p_description,'')),p_division_id,v_email);
  else
    select * into old from public.departments where id=p_id and removed_at is null for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode='40001'; end if;
    target := p_id;
    update public.departments set name=btrim(p_name),initials=upper(btrim(p_initials)),description=btrim(coalesce(p_description,'')),
      division_id=p_division_id,email=v_email,updated_at=clock_timestamp() where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-department',target);
  return target;
end; $function$
;

CREATE OR REPLACE FUNCTION public.save_division(p_id text, p_name text, p_description text, p_email text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target text; old public.divisions;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if exists(select 1 from public.divisions where is_active is not false and lower(btrim(name)) = lower(btrim(p_name)) and id is distinct from p_id) then
    raise exception 'Division name already exists' using errcode = '23505';
  end if;
  if p_id is null then
    target := 'division-' || gen_random_uuid()::text;
    insert into public.divisions(id,name,description,email) values(target,p_name,p_description,p_email);
  else
    select * into old from public.divisions where id = p_id and is_active is not false for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = '40001'; end if;
    target := p_id;
    update public.divisions set name=p_name,description=p_description,email=p_email where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-division',target);
  return target;
end; $function$
;

CREATE OR REPLACE FUNCTION public.set_employee_positions(p_profile_id uuid, p_titles text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare person public.profiles; titles text[]; i integer;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode = '42501'; end if;
  select array_agg(t order by n) into titles from (
    select distinct on (lower(btrim(t))) btrim(t) as t, n
    from unnest(coalesce(p_titles, '{}')) with ordinality as x(t, n)
    where btrim(coalesce(t, '')) <> '' order by lower(btrim(t)), n
  ) cleaned;
  if titles is null or cardinality(titles) = 0 then
    raise exception 'A position is required for a department assignment' using errcode = '23514';
  end if;
  if cardinality(titles) > 10 or exists (select 1 from unnest(titles) t where char_length(t) > 100) then
    raise exception 'Invalid position fields' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into person from public.profiles where id = p_profile_id and deleted_at is null for update;
  if not found or person.department_id is null then
    raise exception 'Organization changed; refresh and try again' using errcode = '40001';
  end if;
  if exists (select 1 from public.departments d where d.id = person.department_id and (d.removed_at is not null or d.deletion_job_id is not null)) then
    raise exception 'Department is no longer available' using errcode = '23514';
  end if;
  perform pg_catalog.set_config('hawkim.positions_managed', 'on', true);
  delete from public.employee_positions where profile_id = person.id;
  for i in 1 .. cardinality(titles) loop
    insert into public.employee_positions(profile_id, department_id, title, sort_order)
    values (person.id, person.department_id, titles[i], i - 1);
  end loop;
  update public.profiles set position = titles[1] where id = person.id and position is distinct from titles[1];
  perform pg_catalog.set_config('hawkim.positions_managed', 'off', true);
  insert into public.organization_management_audit(actor_id, action, entity_id, details)
  values (auth.uid(), 'set-employee-positions', person.id::text,
    jsonb_build_object('departmentId', person.department_id, 'positions', to_jsonb(titles)));
end; $function$
;


notify pgrst, 'reload schema';
commit;
