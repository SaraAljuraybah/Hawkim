-- READ ONLY. Run as database owner in SQL Editor; contains no migration repair.
-- Catalog results do not prove behavior with a real user's JWT.
begin read only;
select version, to_jsonb(m)->>'name' as name,
  md5(coalesce(to_jsonb(m)->>'statements', '')) as statements_digest
from supabase_migrations.schema_migrations m
where version >= '20261103120000' order by version;

select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where (table_schema = 'public' and table_name in ('divisions', 'departments', 'profiles', 'user_roles'))
   or (table_schema = 'auth' and table_name = 'users' and column_name in ('id', 'deleted_at', 'banned_until'))
order by table_schema, table_name, ordinal_position;

select c.conrelid::regclass as table_name, c.conname, c.convalidated, pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.conrelid in ('public.divisions'::regclass, 'public.departments'::regclass) order by 1, 2;
select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('divisions', 'departments');
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename in ('divisions', 'departments', 'profiles', 'user_roles',
  'employee_positions', 'organization_management_audit', 'department_file_deletions', 'department_file_deletion_items', 'access_requests');
select c.oid::regclass as table_name, c.relrowsecurity, c.relforcerowsecurity, c.relacl
from pg_class c where c.oid in ('public.divisions'::regclass, 'public.departments'::regclass, 'public.profiles'::regclass, 'public.user_roles'::regclass);
select * from information_schema.column_privileges where table_schema = 'public' and table_name = 'divisions';
select p.oid::regprocedure as signature, p.prosecdef as security_definer, p.proconfig, p.proacl,
  pg_get_userbyid(p.proowner) as owner, pg_get_functiondef(p.oid) as definition
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('has_role', 'is_active_user', 'can_read_organizational_structure', 'can_manage_organization',
    'get_organizational_structure', 'get_divisions_departments', 'get_employees_missing_positions',
    'save_division', 'delete_division', 'save_department', 'delete_department', 'set_employee_positions',
    'create_employee_profile', 'set_user_roles', 'delete_user_profile', 'begin_department_file_deletion',
    'get_department_file_deletion', 'claim_department_file_deletion', 'ack_department_file_deletion',
    'department_file_paths_present', 'accept_access_request', 'reject_access_request', 'update_sop_description');

-- Snapshot totals and relationship gaps, without employee contact details.
select (select count(*) from public.divisions) as divisions,
  (select count(*) from public.departments where removed_at is null) as active_departments,
  (select count(*) from public.profiles where deleted_at is null) as active_profiles;
select d.id, d.division_id, count(p.id) as assigned_active_profiles from public.departments d
left join public.profiles p on p.department_id = d.id and p.deleted_at is null
where d.removed_at is null group by d.id, d.division_id order by d.id;
commit;
