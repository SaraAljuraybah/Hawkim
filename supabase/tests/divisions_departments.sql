-- Disposable local fixtures only. Historical division email and assignments must survive migration.
insert into public.departments(id,name,initials) values('home','Home','HM'),('employees','Employees','EM'),('move','Move','MV'),('delete','Delete','DL'),('active','Active','AC');
insert into auth.users(id) select ('a1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,4) n;
insert into public.profiles(id,full_name,email,initials,department_id) values
('a1000000-0000-4000-8000-000000000001','Admin','admin@test.invalid','AD','home'),
('a1000000-0000-4000-8000-000000000002','Author','author@test.invalid','AU','home'),
('a1000000-0000-4000-8000-000000000003','Employee','employee@test.invalid','EM','employees');
insert into public.user_roles(user_id,role) values
('a1000000-0000-4000-8000-000000000001','admin'),
('a1000000-0000-4000-8000-000000000002','author'),
('a1000000-0000-4000-8000-000000000002','reviewer'),
('a1000000-0000-4000-8000-000000000003','reviewer');
do $$ begin
  assert (select email is null and name='Existing division' from public.divisions where id='legacy');
  assert (select division_id='legacy' from public.departments where id='preserved');
end $$;
update public.departments set division_id='legacy' where id in ('home','employees');

begin;
insert into public.sops(id,title,department_id,author_id,current_version,status) values
('b1000000-0000-4000-8000-000000000001','Move SOP','move','a1000000-0000-4000-8000-000000000002',2,'published'),
('b1000000-0000-4000-8000-000000000002','Delete SOP','delete','a1000000-0000-4000-8000-000000000002',1,'draft'),
('b1000000-0000-4000-8000-000000000003','Active SOP','active','a1000000-0000-4000-8000-000000000002',1,'in-review');
insert into public.sop_versions(sop_id,version,file_name,file_type,storage_path,file_size,uploaded_by)
select s.id,v,'fixture.pdf','pdf',s.id::text||'/'||v||'.pdf',100,s.author_id from public.sops s cross join generate_series(1,2) v where v<=s.current_version;
commit;

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',false);
set role authenticated;
do $$ begin
  begin perform public.get_divisions_departments(); raise exception 'Non-admin read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.save_division(null,'Unauthorized','','x@test.invalid'); raise exception 'Non-admin write allowed'; exception when insufficient_privilege then null; end;
  begin perform public.delete_department('move','others',now()); raise exception 'Non-admin deletion allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false);
set role authenticated;
do $$
declare snapshot jsonb; division text; department text; token timestamptz; sop_total int;
begin
  snapshot := public.get_divisions_departments();
  assert (select (v->>'email') is null from jsonb_array_elements(snapshot->'divisions') v where v->>'id'='legacy'), 'Legacy email invented';
  assert (select (d->>'employees')::int=2 from jsonb_array_elements(snapshot->'departments') d where d->>'id'='home'), 'Roles multiplied employees';
  assert (select (d->>'sops')::int=1 from jsonb_array_elements(snapshot->'departments') d where d->>'id'='move'), 'Versions multiplied SOPs';
  begin perform public.save_division(null,'Invalid','',''); raise exception 'Missing email accepted'; exception when check_violation then null; end;
  begin perform public.save_division(null,'Invalid','','bad-email'); raise exception 'Bad email accepted'; exception when check_violation then null; end;
  division := public.save_division(null,' New Division ',' Description ',' division@test.invalid ');
  select updated_at into token from public.divisions where id=division;
  perform public.save_division(division,'Edited division','Edited','edited@test.invalid',token);
  begin perform public.save_division(division,'Stale','','stale@test.invalid',token); raise exception 'Stale update allowed'; exception when serialization_failure then null; end;
  department := public.save_department(null,'New Department','ND','New description',division);
  select updated_at into token from public.departments where id=department;
  perform public.save_department(department,'Edited Department','ND','','legacy',token);
  assert (select division_id='legacy' from public.departments where id=department);
  begin perform public.delete_division('legacy',(select updated_at from public.divisions where id='legacy')); raise exception 'Division with departments deleted'; exception when foreign_key_violation then null; end;
  begin perform public.delete_department('employees','empty',(select updated_at from public.departments where id='employees')); raise exception 'Department with employees deleted'; exception when foreign_key_violation then null; end;
  begin perform public.delete_department('move','empty',(select updated_at from public.departments where id='move')); raise exception 'SOP choice bypassed'; exception when foreign_key_violation then null; end;
  begin perform public.delete_department('active','delete',(select updated_at from public.departments where id='active')); raise exception 'Active workflow deleted'; exception when check_violation then null; end;
  assert (select removed_at is null from public.departments where id='active');
  perform public.delete_department('move','others',(select updated_at from public.departments where id='move'));
  perform public.delete_department('delete','delete',(select updated_at from public.departments where id='delete'));
  assert (select removed_at is not null from public.departments where id='move');
  begin perform public.delete_department('move','others',(select updated_at from public.departments where id='move')); raise exception 'Duplicate deletion accepted'; exception when serialization_failure then null; end;
  perform public.delete_department(department,'empty',(select updated_at from public.departments where id=department));
  perform public.delete_division(division,(select updated_at from public.divisions where id=division));
end $$;
reset role;
do $$ begin
  assert (select directory_group='others' and deleted_at is null and department_id='move' from public.sops where title='Move SOP');
  assert (select count(*)=2 from public.sop_versions where sop_id='b1000000-0000-4000-8000-000000000001' and deleted_at is null), 'Moved versions lost';
  assert (select deleted_at is not null from public.sops where title='Delete SOP');
  assert (select deleted_at is not null from public.sop_versions where sop_id='b1000000-0000-4000-8000-000000000002');
end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',false);
set role authenticated;
do $$ begin
  assert public.can_view_sop('b1000000-0000-4000-8000-000000000001'), 'Moved SOP author lost access';
  assert not public.can_view_sop('b1000000-0000-4000-8000-000000000002'), 'Deleted SOP still visible';
  assert not public.can_view_version('b1000000-0000-4000-8000-000000000002',1), 'Deleted file still readable';
end $$;
reset role;
-- Force failure after SOP updates to prove the whole removal rolls back atomically.
insert into public.departments(id,name,initials) values('rollback','Rollback','RB');
begin;
insert into public.sops(id,title,department_id,author_id,current_version) values('b1000000-0000-4000-8000-000000000004','Rollback SOP','rollback','a1000000-0000-4000-8000-000000000002',1);
insert into public.sop_versions(sop_id,version,file_name,file_type,storage_path,file_size,uploaded_by)
values('b1000000-0000-4000-8000-000000000004',1,'rollback.pdf','pdf','rollback/1.pdf',100,'a1000000-0000-4000-8000-000000000002');
commit;
create function public.test_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$;
create trigger test_audit_failure before insert on public.organization_management_audit for each row execute function public.test_audit_failure();
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false);
do $$ begin
  begin perform public.delete_department('rollback','delete',(select updated_at from public.departments where id='rollback')); exception when raise_exception then assert sqlerrm='forced audit failure'; end;
  assert (select removed_at is null from public.departments where id='rollback'), 'Partial department deletion';
  assert (select deleted_at is null and directory_group='department' from public.sops where title='Rollback SOP'), 'Partial SOP deletion';
  assert (select deleted_at is null from public.sop_versions where sop_id='b1000000-0000-4000-8000-000000000004'), 'Partial version deletion';
end $$;
drop trigger test_audit_failure on public.organization_management_audit;
drop function public.test_audit_failure();
do $$ begin
  assert not has_function_privilege('anon','public.get_divisions_departments()','EXECUTE');
  assert not has_table_privilege('authenticated','public.divisions','UPDATE');
  assert not has_table_privilege('authenticated','public.departments','DELETE');
  assert not has_table_privilege('authenticated','public.organization_management_audit','INSERT');
end $$;

-- An issued token belonging to a banned or ended administrator is rejected.
update auth.users set banned_until=now()+interval '1 day' where id='a1000000-0000-4000-8000-000000000001';
set role authenticated;
do $$ begin
  begin perform public.get_divisions_departments(); raise exception 'Banned admin allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update auth.users set banned_until=null where id='a1000000-0000-4000-8000-000000000001';
-- Child records cannot resurrect deleted SOPs through older RPCs or direct service writes.
do $$ begin
  begin
    update public.sop_versions set file_name='resurrected.pdf' where sop_id='b1000000-0000-4000-8000-000000000002';
    raise exception 'Deleted version changed';
  exception when check_violation then null; end;
  begin update public.sops set deleted_at=null where title='Delete SOP'; raise exception 'SOP resurrected'; exception when check_violation then null; end;
end $$;
