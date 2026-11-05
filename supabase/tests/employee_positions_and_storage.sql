-- Disposable local database only (after 20261105140000 and 20261105150000). Fixtures come from
-- divisions_departments.sql / department_storage_cleanup.sql. Admin = ...01, author = ...02.
do $$ begin
  assert (select count(*)=1 and min(title)='Administrator' from public.employee_positions
    where profile_id='a1000000-0000-4000-8000-000000000001'), 'Existing position not backfilled';
  assert not has_table_privilege('authenticated','public.employee_positions','INSERT'), 'Browser can write positions';
  assert not has_table_privilege('authenticated','public.employee_positions','DELETE');
  assert not has_function_privilege('anon','public.set_employee_positions(uuid,text[])','EXECUTE');
  assert not has_function_privilege('authenticated','public.department_file_paths_present(uuid,text[])','EXECUTE');
end $$;

-- Non-admins cannot change positions.
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',false);
set role authenticated;
do $$ begin
  begin perform public.set_employee_positions('a1000000-0000-4000-8000-000000000002',array['Forged']); raise exception 'Non-admin positions allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Admin: several positions, de-duplicated case-insensitively, first is primary; at least one required.
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false);
set role authenticated;
do $$ declare snapshot jsonb; person jsonb; division jsonb; begin
  perform public.set_employee_positions('a1000000-0000-4000-8000-000000000002',array[' Safety Officer ','QPPV Deputy','safety officer','']);
  snapshot := public.get_divisions_departments();
  select p into person from jsonb_array_elements(snapshot->'departments') d, jsonb_array_elements(d->'people') p
    where p->>'id'='a1000000-0000-4000-8000-000000000002';
  assert person->'positions' = '["Safety Officer","QPPV Deputy"]'::jsonb, 'Positions wrong: '||(person->'positions')::text;
  assert (select (d->>'employees')::int=2 from jsonb_array_elements(snapshot->'departments') d where d->>'id'='home'), 'Positions multiplied employees';
  -- Division totals are computed by the server over all of the division's departments.
  select v into division from jsonb_array_elements(snapshot->'divisions') v where v->>'id'='legacy';
  assert (division->>'employees')::int = (select sum((d->>'employees')::int) from jsonb_array_elements(snapshot->'departments') d where d->>'division_id'='legacy'), 'Division employees';
  assert (division->>'sops')::int = (select sum((d->>'sops')::int) from jsonb_array_elements(snapshot->'departments') d where d->>'division_id'='legacy'), 'Division SOPs';
  assert (division->>'department_count')::int = (select count(*) from jsonb_array_elements(snapshot->'departments') d where d->>'division_id'='legacy'), 'Division department count';
  begin perform public.set_employee_positions('a1000000-0000-4000-8000-000000000002',array['  ']); raise exception 'Empty positions accepted';
  exception when check_violation then null; end;
  begin perform public.set_employee_positions('a1000000-0000-4000-8000-000000000002',null); raise exception 'Null positions accepted';
  exception when check_violation then null; end;
end $$;
reset role;
do $$ begin
  assert (select position='Safety Officer' from public.profiles where id='a1000000-0000-4000-8000-000000000002'), 'Primary not synced';
  assert exists(select 1 from public.organization_management_audit where action='set-employee-positions'), 'Positions change not audited';
end $$;

-- Commit-time rule, checked immediately here: removing the last position / assigning without one fails.
do $$ begin
  begin
    delete from public.employee_positions where profile_id='a1000000-0000-4000-8000-000000000002';
    set constraints all immediate;
    raise exception 'Last position removed';
  exception when check_violation then null; end;
  begin
    insert into auth.users(id) values('a1000000-0000-4000-8000-000000000009');
    insert into public.profiles(id,full_name,email,initials,department_id) values('a1000000-0000-4000-8000-000000000009','No Position','nopos@test.invalid','NP','home');
    set constraints all immediate;
    raise exception 'Assignment without a position accepted';
  exception when check_violation then null; end;
  begin
    insert into public.employee_positions(profile_id,department_id,title) values('a1000000-0000-4000-8000-000000000002','employees','Elsewhere');
    raise exception 'Position outside home department accepted';
  exception when check_violation then null; end;
end $$;
-- A profile can be assigned with its position in one transaction.
begin;
insert into auth.users(id) values('a1000000-0000-4000-8000-000000000008');
insert into public.profiles(id,full_name,email,initials,department_id,position) values('a1000000-0000-4000-8000-000000000008','New Hire','new-hire@test.invalid','NH','home','Analyst');
commit;
-- Moving department moves the primary position and drops the old department's positions.
update public.profiles set department_id='employees' where id='a1000000-0000-4000-8000-000000000002';
do $$ begin
  assert (select array_agg(title order by title)=array['Safety Officer'] and bool_and(department_id='employees')
    from public.employee_positions where profile_id='a1000000-0000-4000-8000-000000000002'), 'Department move did not carry positions';
end $$;
update public.profiles set department_id='home' where id='a1000000-0000-4000-8000-000000000002';

-- Storage verification: a path is acknowledged only once storage.objects no longer has it.
insert into public.departments(id,name,initials) values('verify','Verify fixture','VF');
begin;
insert into public.sops(id,title,department_id,author_id,current_version,status)
values('d1000000-0000-4000-8000-000000000001','Verify SOP','verify','a1000000-0000-4000-8000-000000000002',1,'draft');
insert into public.sop_versions(sop_id,version,file_name,file_type,storage_path,file_size,uploaded_by)
values('d1000000-0000-4000-8000-000000000001',1,'v.pdf','pdf','verify/1.pdf',100,'a1000000-0000-4000-8000-000000000002');
commit;
insert into storage.objects(bucket_id,name) values('sop-files','verify/1.pdf');
set role authenticated;
do $$ declare job uuid; begin
  job := public.begin_department_file_deletion('verify',(select updated_at from public.departments where id='verify'));
  perform set_config('test.verify.job',job::text,false);
end $$;
reset role;
set role service_role;
do $$ declare job uuid := current_setting('test.verify.job')::uuid; claim jsonb; begin
  claim := public.claim_department_file_deletion(job);
  assert public.department_file_paths_present(job,array['verify/1.pdf','unrelated']) = array['verify/1.pdf'];
  begin perform public.ack_department_file_deletion(job,(claim->>'leaseToken')::uuid,array['verify/1.pdf'],false);
    raise exception 'Present object acknowledged as deleted';
  exception when check_violation then null; end;
  assert public.ack_department_file_deletion(job,(claim->>'leaseToken')::uuid,'{}',true) = 'failed';
end $$;
reset role;
-- Simulates the Storage API removing the object (the API, not SQL, does this in production).
delete from storage.objects where bucket_id='sop-files' and name='verify/1.pdf';
set role service_role;
do $$ declare job uuid := current_setting('test.verify.job')::uuid; claim jsonb; begin
  claim := public.claim_department_file_deletion(job);
  assert public.department_file_paths_present(job,array['verify/1.pdf']) = '{}';
  assert public.ack_department_file_deletion(job,(claim->>'leaseToken')::uuid,array['verify/1.pdf'],false) = 'completed';
end $$;
reset role;
do $$ begin
  assert (select removed_at is not null from public.departments where id='verify'), 'Not finalized after verified absence';
  assert (select (details->>'fileCount')::int=1 from public.organization_management_audit
    where action='department-file-deletion-completed' and entity_id='verify'), 'Audit file count';
end $$;
