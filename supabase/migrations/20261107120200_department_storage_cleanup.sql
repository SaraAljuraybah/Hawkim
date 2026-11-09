-- Divisions & Departments 3/4: department deletion with durable Storage cleanup. Reconciled from the
-- feat/divisions-departments migrations 20261105130000 + 20261105150000. Requires 20261107120000 and
-- 20261107120100. See docs/divisions-departments.md.
--
-- Deleting a department "with its SOPs" uses a durable Storage cleanup outbox processed by the
-- delete-department Edge Function (service role). No SQL DELETE against storage.objects: only the
-- Storage API removes file contents, and a path counts as deleted only when the DATABASE sees that
-- its storage.objects row is gone.
--
-- Corrections against the Hawkim-1 originals:
--  * Cleanup items exclude NULL, empty/blank and duplicate storage paths (select distinct,
--    on conflict do nothing), so one bad or repeated path can't fail the whole deletion.
--  * delete_department() is defined once here in its final form (it was created in 120200 with a
--    direct soft-delete "delete" path and replaced here); "delete" must use the Edge Function.
--  * ack_department_file_deletion() is defined once, with the Storage-absence check (150000).
--  * Develop's delete_sop()/delete_sop_version() and their Edge Function are not changed.

begin;

create table public.department_file_deletions (
  id uuid primary key default gen_random_uuid(),
  department_id text not null unique references public.departments(id),
  requested_by uuid not null references public.profiles(id),
  sop_ids uuid[] not null,
  state text not null default 'pending' check(state in ('pending','processing','failed','completed')),
  attempts integer not null default 0,
  lease_token uuid, lease_until timestamptz,
  error_code text check(error_code is null or error_code in ('storage-cleanup-incomplete')),
  created_at timestamptz not null default now(), completed_at timestamptz
);
create table public.department_file_deletion_items (
  job_id uuid not null references public.department_file_deletions(id),
  bucket_id text not null check(bucket_id='sop-files'),
  storage_path text not null check(btrim(storage_path) <> ''),
  deleted_at timestamptz,
  primary key(job_id,bucket_id,storage_path)
);
alter table public.departments add column deletion_job_id uuid references public.department_file_deletions(id);
alter table public.department_file_deletions enable row level security;
alter table public.department_file_deletion_items enable row level security;
revoke all on public.department_file_deletions,public.department_file_deletion_items from public,anon,authenticated,service_role;

-- Pending removal must not receive new assignments or organizational edits.
create or replace function public.guard_active_department() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.departments where id=new.department_id and removed_at is null
    and deletion_job_id is null for share) then
    raise exception 'Department is no longer available' using errcode='23514';
  end if;
  return new;
end; $$;
create function public.guard_pending_department_edit() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.deletion_job_id is not null and new.removed_at is null then
    raise exception 'Department file cleanup is pending' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger departments_pending_edit before update on public.departments
for each row execute function public.guard_pending_department_edit();

create function public.begin_department_file_deletion(p_id text,p_expected_updated_at timestamptz) returns uuid
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

create function public.get_department_file_deletion(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  select jsonb_build_object('id',j.id,'state',j.state,'attempts',j.attempts,'errorCode',j.error_code,
    'totalFiles',(select count(*) from public.department_file_deletion_items where job_id=j.id),
    'deletedFiles',(select count(*) from public.department_file_deletion_items where job_id=j.id and deleted_at is not null))
    into result from public.department_file_deletions j where j.id=p_job_id;
  if result is null then raise exception 'Deletion job unavailable' using errcode='40001'; end if;
  return result;
end; $$;

-- Only a verified server worker can claim/acknowledge jobs. Browser callers never get file paths.
create function public.claim_department_file_deletion(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end; $$;

-- Server worker only: which of these job paths still exist in Storage.
create function public.department_file_paths_present(p_job_id uuid, p_paths text[]) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(i.storage_path order by i.storage_path), '{}')
  from public.department_file_deletion_items i
  where i.job_id = p_job_id and i.storage_path = any(coalesce(p_paths, '{}'))
    and exists (select 1 from storage.objects o where o.bucket_id = i.bucket_id and o.name = i.storage_path);
$$;

create function public.ack_department_file_deletion(p_job_id uuid,p_lease_token uuid,p_deleted_paths text[],p_failed boolean) returns text
language plpgsql security definer set search_path='' as $$
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
end; $$;

-- Prevent a browser from recreating a deleted file at an already-owned path. Develop's uploads
-- always use a new random path (services/files.ts), so they are unaffected.
create function public.is_unused_sop_upload_path(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.sop_versions where storage_path=p_path)
    and not exists(select 1 from public.department_file_deletion_items where storage_path=p_path);
$$;
create policy "Previously owned SOP paths cannot be reused" on storage.objects as restrictive
  for insert to authenticated with check(bucket_id<>'sop-files' or public.is_unused_sop_upload_path(name));

-- Delete a department WITHOUT permanent file deletion: 'empty' (no SOPs) or 'others' (its SOPs stay,
-- shown under Others). Deleting its SOPs ('delete') goes through begin_department_file_deletion()
-- and the delete-department Edge Function.
create function public.delete_department(p_id text,p_sop_action text,p_expected_updated_at timestamptz) returns void
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

revoke all on function public.guard_pending_department_edit() from public,anon,authenticated,service_role;
revoke all on function public.begin_department_file_deletion(text,timestamptz),public.get_department_file_deletion(uuid),
 public.claim_department_file_deletion(uuid),public.department_file_paths_present(uuid,text[]),
 public.ack_department_file_deletion(uuid,uuid,text[],boolean),public.is_unused_sop_upload_path(text),
 public.delete_department(text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.begin_department_file_deletion(text,timestamptz),public.get_department_file_deletion(uuid),
 public.is_unused_sop_upload_path(text),public.delete_department(text,text,timestamptz) to authenticated;
grant execute on function public.claim_department_file_deletion(uuid),public.department_file_paths_present(uuid,text[]),
 public.ack_department_file_deletion(uuid,uuid,text[],boolean) to service_role;

notify pgrst,'reload schema';
commit;
