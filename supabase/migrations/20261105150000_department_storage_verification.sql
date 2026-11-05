-- Follow-up to 20261105130000: Storage absence is verified by the DATABASE, not only reported by
-- the worker. Storage keeps one storage.objects row per stored file (the same metadata the Storage
-- API's info/list read), so a path is acknowledged as deleted only when no such row remains.
-- No SQL DELETE against storage.objects: only the Storage API removes file contents.
begin;

-- Server worker only: which of these job paths still exist in Storage.
create function public.department_file_paths_present(p_job_id uuid, p_paths text[]) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(i.storage_path order by i.storage_path), '{}')
  from public.department_file_deletion_items i
  where i.job_id = p_job_id and i.storage_path = any(coalesce(p_paths, '{}'))
    and exists (select 1 from storage.objects o where o.bucket_id = i.bucket_id and o.name = i.storage_path);
$$;

create or replace function public.ack_department_file_deletion(p_job_id uuid,p_lease_token uuid,p_deleted_paths text[],p_failed boolean) returns text
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

revoke all on function public.department_file_paths_present(uuid,text[]),
  public.ack_department_file_deletion(uuid,uuid,text[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.department_file_paths_present(uuid,text[]),
  public.ack_department_file_deletion(uuid,uuid,text[],boolean) to service_role;
notify pgrst,'reload schema';
commit;
