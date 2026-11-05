-- Disposable local database only (after 20261105160000). Admin = a1...01, author = a1...02 (from
-- divisions_departments.sql). New fixtures here use c2... (people) and c3... (SOPs).
-- The local auth.users stand-in has no email column; real Supabase Auth has one.
alter table auth.users add column if not exists email text;
insert into public.departments(id,name,initials) values('staff','Staff','ST');
insert into auth.users(id,email) values
('c2000000-0000-4000-8000-000000000001','lead@test.invalid'),
('c2000000-0000-4000-8000-000000000002','new@test.invalid'),
('c2000000-0000-4000-8000-000000000003','orphan@test.invalid'),
('c2000000-0000-4000-8000-000000000004','legacy@test.invalid');
insert into public.profiles(id,full_name,email,initials,department_id,position)
values('c2000000-0000-4000-8000-000000000001','Lead','lead@test.invalid','LD','staff','Lead');
-- A legacy profile from before positions were required (triggers off only to create the fixture).
set session_replication_role = replica;
insert into public.profiles(id,full_name,email,initials,department_id)
values('c2000000-0000-4000-8000-000000000004','Legacy','legacy@test.invalid','LG','staff');
set session_replication_role = origin;

do $$ begin
  assert not has_function_privilege('anon','public.create_employee_profile(uuid,text,text,text,text,text[],public.app_role[])','EXECUTE');
  assert not has_function_privilege('anon','public.set_user_roles(uuid,public.app_role[])','EXECUTE');
  assert not has_function_privilege('anon','public.delete_user_profile(uuid)','EXECUTE');
  assert not has_function_privilege('authenticated','public.user_role_in_use(uuid,public.app_role)','EXECUTE');
  assert not has_function_privilege('anon','public.get_employees_missing_positions()','EXECUTE');
end $$;

-- ---------- Non-admins are refused everywhere ----------
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',false);
set role authenticated;
do $$ begin
  begin perform public.create_employee_profile(null,'X','x@test.invalid','0512345678','staff',array['X'],'{}'); raise exception 'Non-admin create';
  exception when insufficient_privilege then null; end;
  begin perform public.set_user_roles('c2000000-0000-4000-8000-000000000001','{admin}'); raise exception 'Non-admin roles';
  exception when insufficient_privilege then null; end;
  begin perform public.delete_user_profile('c2000000-0000-4000-8000-000000000001'); raise exception 'Non-admin delete';
  exception when insufficient_privilege then null; end;
  begin perform public.get_employees_missing_positions(); raise exception 'Non-admin audit';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false);
set role authenticated;
-- ---------- Positions stay consistent ----------
do $$ declare titles text[]; begin
  -- Reordering through the admin RPC keeps every title (the profile trigger must not drop the old primary).
  perform public.set_employee_positions('c2000000-0000-4000-8000-000000000001',array['Lead','Trainer']);
  perform public.set_employee_positions('c2000000-0000-4000-8000-000000000001',array['Trainer','Lead']);
  select array_agg(title order by sort_order) into titles from public.employee_positions where profile_id='c2000000-0000-4000-8000-000000000001';
  assert titles = array['Trainer','Lead'], 'Reorder lost a position: '||titles::text;
  assert (select position='Trainer' from public.profiles where id='c2000000-0000-4000-8000-000000000001');
end $$;
reset role;
-- A direct edit of the primary title replaces the primary row; the secondary title stays.
update public.profiles set position='Team Lead' where id='c2000000-0000-4000-8000-000000000001';
do $$ declare titles text[]; begin
  select array_agg(title order by sort_order) into titles from public.employee_positions where profile_id='c2000000-0000-4000-8000-000000000001';
  assert titles = array['Team Lead','Lead'], 'Primary rename wrong: '||titles::text;
end $$;
-- Promoting an existing secondary title: it becomes first, the replaced primary row goes, nothing duplicates.
update public.profiles set position='Lead' where id='c2000000-0000-4000-8000-000000000001';
do $$ declare titles text[]; begin
  select array_agg(title order by sort_order) into titles from public.employee_positions where profile_id='c2000000-0000-4000-8000-000000000001';
  assert titles = array['Lead'], 'Promotion wrong: '||titles::text;
end $$;
-- Adding a secondary title and editing the primary only in case keeps both.
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false);
set role authenticated;
select public.set_employee_positions('c2000000-0000-4000-8000-000000000001',array['Lead','Mentor']);
reset role;
update public.profiles set position='LEAD' where id='c2000000-0000-4000-8000-000000000001';
do $$ declare titles text[]; begin
  select array_agg(title order by sort_order) into titles from public.employee_positions where profile_id='c2000000-0000-4000-8000-000000000001';
  assert titles = array['LEAD','Mentor'], 'Case-only rename wrong: '||titles::text;
end $$;

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false);
set role authenticated;
-- ---------- Missing-position audit (read only, nothing invented) ----------
do $$ declare missing jsonb; begin
  missing := public.get_employees_missing_positions();
  assert missing @> '[{"id":"c2000000-0000-4000-8000-000000000004","departmentId":"staff"}]'::jsonb, 'Legacy profile not listed: '||missing::text;
  assert not missing @> '[{"id":"c2000000-0000-4000-8000-000000000001"}]'::jsonb, 'Profile with positions listed';
end $$;
reset role;
do $$ begin
  assert not exists(select 1 from public.employee_positions where profile_id='c2000000-0000-4000-8000-000000000004'), 'Audit invented a position';
  assert (select position is null from public.profiles where id='c2000000-0000-4000-8000-000000000004'), 'Audit changed the profile';
end $$;

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false);
set role authenticated;
-- ---------- Optional division email ----------
do $$ declare v_id text; begin
  v_id := public.save_division(null,'Optional Email Division','',null);
  assert (select email is null from public.divisions where divisions.id=v_id), 'Null email not kept';
  v_id := public.save_division(null,'Blank Email Division','','   ');
  assert (select email is null from public.divisions where divisions.id=v_id), 'Blank email not stored as null';
  begin perform public.save_division(null,'Bad Email Division','','not-an-email'); raise exception 'Malformed email accepted';
  exception when check_violation then null; end;
end $$;

-- ---------- Creating users ----------
do $$ declare before_count integer; snapshot jsonb; begin
  -- Dry run (before an Auth account exists): validates, creates nothing.
  assert public.create_employee_profile(null,'New Person','new@test.invalid','0512345678','staff',array['Analyst'],'{author}') is null;
  assert not exists(select 1 from public.profiles where id='c2000000-0000-4000-8000-000000000002'), 'Dry run created a profile';
  begin perform public.create_employee_profile(null,'New Person','new@test.invalid','12345','staff',array['Analyst'],'{}'); raise exception 'Bad phone accepted';
  exception when check_violation then null; end;
  begin perform public.create_employee_profile(null,'New Person','new@test.invalid','0512345678','staff','{}','{}'); raise exception 'No position accepted';
  exception when check_violation then null; end;
  begin perform public.create_employee_profile(null,'New Person','new@test.invalid','0512345678','staff',array['Analyst'],'{approver}'); raise exception 'Approver outside Quality';
  exception when check_violation then null; end;
  begin perform public.create_employee_profile(null,'New Person','new@test.invalid','0512345678','staff',array['Analyst'],'{admin,author}'); raise exception 'Admin with other role';
  exception when check_violation then null; end;
  begin perform public.create_employee_profile(null,'Dup','LEAD@test.invalid','0512345678','staff',array['Analyst'],'{}'); raise exception 'Duplicate email';
  exception when unique_violation then null; end;
  begin perform public.create_employee_profile(null,'New Person','new@test.invalid','0512345678','missing-department',array['Analyst'],'{}'); raise exception 'Unknown department';
  exception when check_violation then null; end;
  -- The Auth account must exist for exactly this email.
  begin perform public.create_employee_profile('c2000000-0000-4000-8000-000000000003','Someone','someone-else@test.invalid','0512345678','staff',array['Analyst'],'{}');
    raise exception 'Mismatched Auth account accepted';
  exception when serialization_failure then null; end;

  snapshot := public.get_divisions_departments();
  select (d->>'employees')::int into before_count from jsonb_array_elements(snapshot->'departments') d where d->>'id'='staff';
  perform public.create_employee_profile('c2000000-0000-4000-8000-000000000002','  New   Person ',' New@Test.invalid ','05 1234 5678','staff',
    array[' Analyst ','auditor','ANALYST'],'{author,reviewer}');
  snapshot := public.get_divisions_departments();
  assert (select (d->>'employees')::int from jsonb_array_elements(snapshot->'departments') d where d->>'id'='staff') = before_count + 1, 'Employee count not persisted';
  begin perform public.create_employee_profile('c2000000-0000-4000-8000-000000000002','New Person','new@test.invalid','0512345678','staff',array['Analyst'],'{}');
    raise exception 'Created twice';
  exception when unique_violation then null; end;
end $$;
reset role;
do $$ declare person public.profiles; titles text[]; begin
  select * into person from public.profiles where id='c2000000-0000-4000-8000-000000000002';
  assert person.email='new@test.invalid' and person.full_name='New   Person' and person.initials='NP'
    and person.phone='+966512345678' and person.position='Analyst' and person.department_id='staff', 'Profile wrong';
  select array_agg(title order by sort_order) into titles from public.employee_positions where profile_id=person.id;
  assert titles = array['Analyst','auditor'], 'Positions wrong: '||titles::text;
  assert (select array_agg(role::text order by role) from public.user_roles where user_id=person.id) = array['author','reviewer'], 'Roles wrong';
  assert exists(select 1 from public.organization_management_audit where action='create-user' and entity_id=person.id::text), 'Create not audited';
end $$;

-- ---------- Permissions ----------
-- An SOP and its current version must commit together (sops_current_version_fkey is deferred).
begin;
insert into public.sops(id,title,department_id,author_id,current_version,status)
values('c3000000-0000-4000-8000-000000000001','Draft by new user','staff','c2000000-0000-4000-8000-000000000002',1,'draft');
insert into public.sop_versions(sop_id,version,file_name,file_type,storage_path,file_size,uploaded_by)
values('c3000000-0000-4000-8000-000000000001',1,'draft.pdf','pdf','c3000000-0000-4000-8000-000000000001/1.pdf',100,'c2000000-0000-4000-8000-000000000002');
commit;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false);
set role authenticated;
do $$ begin
  begin perform public.set_user_roles('a1000000-0000-4000-8000-000000000001','{}'); raise exception 'Own admin removed';
  exception when check_violation then null; end;
  begin perform public.set_user_roles('c2000000-0000-4000-8000-000000000002','{reviewer}'); raise exception 'Author in use removed';
  exception when check_violation then null; end;
  begin perform public.set_user_roles('c2000000-0000-4000-8000-000000000002','{admin,author}'); raise exception 'Admin with other role';
  exception when check_violation then null; end;
  begin perform public.set_user_roles('c2000000-0000-4000-8000-000000000002','{author,reviewer,approver}'); raise exception 'Approver outside Quality';
  exception when check_violation then null; end;
  -- Removing a permission that is not in use is saved.
  perform public.set_user_roles('c2000000-0000-4000-8000-000000000002','{author}');
  assert (select array_agg(role::text) from public.user_roles where user_id='c2000000-0000-4000-8000-000000000002') = array['author'];
  -- A second admin can be removed by the first.
  perform public.set_user_roles('c2000000-0000-4000-8000-000000000001','{admin}');
  perform public.set_user_roles('c2000000-0000-4000-8000-000000000001','{}');
  assert not exists(select 1 from public.user_roles where user_id='c2000000-0000-4000-8000-000000000001');
end $$;

-- ---------- Deleting users ----------
do $$ declare before_count integer; begin
  begin perform public.delete_user_profile('a1000000-0000-4000-8000-000000000001'); raise exception 'Self delete';
  exception when check_violation then null; end;
  begin perform public.delete_user_profile('c2000000-0000-4000-8000-000000000002'); raise exception 'Work in progress ignored';
  exception when check_violation then null; end;
  select (d->>'employees')::int into before_count from jsonb_array_elements(public.get_divisions_departments()->'departments') d where d->>'id'='staff';
  assert public.delete_user_profile('c2000000-0000-4000-8000-000000000001') = 'c2000000-0000-4000-8000-000000000001';
  -- A repeat (e.g. to retry the Auth ban) succeeds without changing anything.
  assert public.delete_user_profile('c2000000-0000-4000-8000-000000000001') = 'c2000000-0000-4000-8000-000000000001';
  assert (select (d->>'employees')::int from jsonb_array_elements(public.get_divisions_departments()->'departments') d where d->>'id'='staff') = before_count - 1,
    'Deleted user still counted';
end $$;
reset role;
do $$ begin
  assert (select deleted_at is not null from public.profiles where id='c2000000-0000-4000-8000-000000000001'), 'Profile not ended';
  -- History stays: positions and the profile row are retained.
  assert exists(select 1 from public.employee_positions where profile_id='c2000000-0000-4000-8000-000000000001'), 'History removed';
  assert exists(select 1 from public.organization_management_audit where action='delete-user'), 'Delete not audited';
end $$;
