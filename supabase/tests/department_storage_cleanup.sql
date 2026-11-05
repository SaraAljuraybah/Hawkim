-- Durable orchestration tests only. Actual Storage API tests run separately on local Supabase.
insert into public.departments(id,name,initials) values('purge','Purge fixture','PF');
begin;
insert into public.sops(id,title,description,department_id,author_id,current_version,status)
values('c1000000-0000-4000-8000-000000000001','Purge contents','Confidential prose','purge','a1000000-0000-4000-8000-000000000002',2,'draft');
insert into public.sop_versions(sop_id,version,file_name,file_type,storage_path,file_size,uploaded_by,deleted_at,deleted_by)
select 'c1000000-0000-4000-8000-000000000001',n,'Content.pdf','pdf','purge/'||n||'.pdf',100,'a1000000-0000-4000-8000-000000000002',
case when n=1 then now() end,case when n=1 then 'a1000000-0000-4000-8000-000000000002'::uuid end from generate_series(1,2) n;
commit;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',false);
set role authenticated;
do $$ begin
  begin perform public.begin_department_file_deletion('purge',now()); raise exception 'Non-admin allowed'; exception when insufficient_privilege then null; end;
  begin perform public.claim_department_file_deletion(gen_random_uuid()); raise exception 'Browser worker access allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false);
set role authenticated;
do $$ declare job uuid; snapshot jsonb; begin
  begin perform public.delete_department('purge','delete',(select updated_at from public.departments where id='purge')); raise exception 'Old soft-only API allowed'; exception when check_violation then null; end;
  job:=public.begin_department_file_deletion('purge',(select updated_at from public.departments where id='purge'));
  perform set_config('test.cleanup.job',job::text,false);
  assert public.begin_department_file_deletion('purge',now())=job,'Retry created a second job';
  snapshot:=public.get_department_file_deletion(job);
  assert (snapshot->>'totalFiles')::int=2,'Missing a previously deleted version';
  assert snapshot->>'state'='pending';
  assert (select removed_at is null and deletion_job_id=job from public.departments where id='purge'),'Reported complete before file deletion';
  assert not public.can_view_sop('c1000000-0000-4000-8000-000000000001');
  begin perform public.delete_department('purge','others',(select updated_at from public.departments where id='purge')); raise exception 'Pending cleanup bypassed'; exception when check_violation then null; end;
end $$;
reset role;
do $$ begin
  begin update public.profiles set department_id='purge' where id='a1000000-0000-4000-8000-000000000002'; raise exception 'Assigned to pending deletion'; exception when check_violation then null; end;
  assert (select title='Deleted SOP' and description='' from public.sops where id='c1000000-0000-4000-8000-000000000001');
  assert not has_function_privilege('authenticated','public.ack_department_file_deletion(uuid,uuid,text[],boolean)','EXECUTE');
  assert not has_table_privilege('authenticated','public.department_file_deletion_items','SELECT');
end $$;
set role service_role;
do $$ declare job uuid:=current_setting('test.cleanup.job')::uuid; claim jsonb; token uuid; begin
  claim:=public.claim_department_file_deletion(job); token:=(claim->>'leaseToken')::uuid;
  assert jsonb_array_length(claim->'files')=2;
  assert public.claim_department_file_deletion(job)->>'state'='busy';
  begin perform public.ack_department_file_deletion(job,null,'{}',false); raise exception 'Missing lease allowed'; exception when serialization_failure then null; end;
  assert public.ack_department_file_deletion(job,token,'{}',true)='failed';
  claim:=public.claim_department_file_deletion(job);
  assert (claim->>'leaseToken')::uuid<>token;
  begin perform public.ack_department_file_deletion(job,token,'{}',false); raise exception 'Stale lease allowed'; exception when serialization_failure then null; end;
  token:=(claim->>'leaseToken')::uuid;
  begin perform public.ack_department_file_deletion(job,token,array['not-owned'],false); raise exception 'Wrong path allowed'; exception when check_violation then null; end;
  assert public.ack_department_file_deletion(job,token,array['purge/1.pdf'],true)='failed';
  claim:=public.claim_department_file_deletion(job);
  assert jsonb_array_length(claim->'files')=1,'Already verified paths retried';
  assert public.ack_department_file_deletion(job,(claim->>'leaseToken')::uuid,array['purge/2.pdf'],false)='completed';
  assert public.claim_department_file_deletion(job)->>'state'='completed';
end $$;
reset role;
do $$ begin
  assert (select removed_at is not null and division_id is null from public.departments where id='purge');
  assert (select state='completed' and completed_at is not null from public.department_file_deletions where id=current_setting('test.cleanup.job')::uuid);
end $$;
