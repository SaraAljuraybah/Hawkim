-- Multi-tenant, step 5: divisions and departments belong to one organization.
--
-- 1. At most one Quality department per organization (was: one in the whole database).
-- 2. The functions of Divisions & Departments and the organizational structure work only on the
--    caller's organization. Each is its LATEST definition (pg_get_functiondef, with every earlier migration
--    applied) with only the changes named above it; an id of another organization gets the answer for an
--    id that doesn't exist (the conflict for an edit or delete). Signatures, SECURITY DEFINER,
--    search_path, owners and grants are unchanged. Names and initials only have to be unique within an
--    organization, so two organizations can both have a "Quality Assurance" department.
--
-- Not changed: get_organizational_structure runs as the caller, so the row-level policies already limit
-- it to their organization (its one definer helper, organizational_structure_emails, is scoped here);
-- can_read_organizational_structure (the caller's own account); claim_department_file_deletion,
-- ack_department_file_deletion and department_file_paths_present (the delete-department Edge Function,
-- with the service role, for the job begin_department_file_deletion created: only that job's rows);
-- validate_division_management and guard_pending_department_edit (one row).
-- New departments keep requires_compliance_check = false by default (unchanged). The departments a new
-- organization starts with are created when its request is accepted.
--
-- Undo: supabase/scripts/rollback_scope_divisions_departments.sql

begin;

-- ---------- 1. One Quality department per organization ----------

drop index public.departments_one_quality;
create unique index departments_one_quality on public.departments (organization_id) where is_quality;

-- ---------- 2. The functions ----------

-- save_division: the name only has to be unique within the organization; an edit only finds a division of the caller's organization.
CREATE OR REPLACE FUNCTION public.save_division(p_id text, p_name text, p_description text, p_email text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target text; old public.divisions;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode = '42501'; end if;
  perform public.lock_organization_changes(public.current_organization_id());
  if exists(select 1 from public.divisions where organization_id = public.current_organization_id() and is_active is not false
    and lower(btrim(name)) = lower(btrim(p_name)) and id is distinct from p_id) then
    raise exception 'Division name already exists' using errcode = '23505';
  end if;
  if p_id is null then
    target := 'division-' || gen_random_uuid()::text;
    insert into public.divisions(id,name,description,email) values(target,p_name,p_description,p_email);
  else
    select * into old from public.divisions where id = p_id and organization_id = public.current_organization_id() and is_active is not false for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict'; end if;
    target := p_id;
    update public.divisions set name=p_name,description=p_description,email=p_email where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-division',target);
  return target;
end; $function$;

-- delete_division: only a division of the caller's organization.
CREATE OR REPLACE FUNCTION public.delete_division(p_id text, p_expected_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old public.divisions;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode = '42501'; end if;
  perform public.lock_organization_changes(public.current_organization_id());
  select * into old from public.divisions where id=p_id and organization_id = public.current_organization_id() and is_active is not false for update;
  if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict'; end if;
  if exists(select 1 from public.departments where division_id=p_id and removed_at is null) then
    raise exception 'Divisions with assigned departments cannot be deleted.' using errcode='23503';
  end if;
  update public.divisions set is_active=false,updated_at=clock_timestamp() where id=p_id;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'delete-division',p_id);
end; $function$;

-- save_department: the division must be the caller's organization's; name and initials only have to be unique within the organization; an edit only finds a department of the caller's organization (a new one is in it: set by the database).
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
    target := 'department-' || gen_random_uuid()::text;
    insert into public.departments(id,name,initials,description,division_id,email)
      values(target,btrim(p_name),upper(btrim(p_initials)),btrim(coalesce(p_description,'')),p_division_id,v_email);
  else
    select * into old from public.departments where id=p_id and organization_id = public.current_organization_id() and removed_at is null for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict'; end if;
    target := p_id;
    update public.departments set name=btrim(p_name),initials=upper(btrim(p_initials)),description=btrim(coalesce(p_description,'')),
      division_id=p_division_id,email=v_email,updated_at=clock_timestamp() where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-department',target);
  return target;
end; $function$;

-- delete_department: only a department of the caller's organization.
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
end; $function$;

-- begin_department_file_deletion: only a department of the caller's organization.
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
end; $function$;

-- get_department_file_deletion: only a deletion job of the caller's organization.
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
    into result from public.department_file_deletions j where j.id=p_job_id and j.organization_id = public.current_organization_id();
  if result is null then raise exception 'Deletion job unavailable' using errcode = 'P0001', hint = 'conflict'; end if;
  return result;
end; $function$;

-- get_divisions_departments: everything it lists and counts is the caller's organization's.
CREATE OR REPLACE FUNCTION public.get_divisions_departments()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  return (
    with roles as (
      select user_id, jsonb_agg(role order by role) as permissions from public.user_roles
      where organization_id = public.current_organization_id() group by user_id
    ), positions as (
      select profile_id, department_id, jsonb_agg(title order by sort_order, lower(title)) as titles
      from public.employee_positions where organization_id = public.current_organization_id() group by profile_id, department_id
    ), active_people as (
      select p.* from public.profiles p
      where p.organization_id = public.current_organization_id() and p.deleted_at is null and p.department_id is not null
    ), employees as (
      select p.department_id, count(distinct p.id) as n, jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'email', p.email, 'initials', p.initials, 'departmentId', p.department_id,
        'permissions', coalesce(r.permissions, '[]'), 'positions', coalesce(pos.titles, '[]')) order by p.full_name, p.id) as people
      from active_people p left join roles r on r.user_id = p.id
      left join positions pos on pos.profile_id = p.id and pos.department_id = p.department_id
      group by p.department_id
    ), live_sops as (
      select s.id, s.department_id, s.status from public.sops s
      where s.organization_id = public.current_organization_id() and s.deleted_at is null and s.directory_group = 'department'
    ), status_counts as (
      select department_id, jsonb_object_agg(status, n) as counts
      from (select department_id, status, count(*) as n from live_sops group by department_id, status) t group by department_id
    ), documents as (
      select department_id, count(*) as n from live_sops group by department_id
    ), division_totals as (
      select d.division_id,
        count(distinct d.id) as departments,
        (select count(distinct p.id) from active_people p join public.departments x on x.id = p.department_id
          where x.division_id = d.division_id and x.removed_at is null) as employees,
        (select count(*) from live_sops s join public.departments x on x.id = s.department_id
          where x.division_id = d.division_id and x.removed_at is null) as sops
      from public.departments d
      where d.organization_id = public.current_organization_id() and d.removed_at is null and d.division_id is not null group by d.division_id
    )
    select jsonb_build_object(
      'divisions', (select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object(
          'department_count', coalesce(t.departments, 0), 'employees', coalesce(t.employees, 0), 'sops', coalesce(t.sops, 0))
        order by v.name, v.id), '[]')
        from public.divisions v left join division_totals t on t.division_id = v.id
        where v.organization_id = public.current_organization_id() and v.is_active is not false),
      'departments', (select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object(
        'employees', coalesce(e.n, 0), 'people', coalesce(e.people, '[]'), 'sops', coalesce(s.n, 0),
        'status_counts', coalesce(c.counts, '{}')) order by d.name, d.id), '[]')
        from public.departments d left join employees e on e.department_id = d.id
        left join documents s on s.department_id = d.id left join status_counts c on c.department_id = d.id
        where d.organization_id = public.current_organization_id() and d.removed_at is null)
    )
  );
end; $function$;

-- organizational_structure_emails: only the caller's organization's divisions and departments.
CREATE OR REPLACE FUNCTION public.organizational_structure_emails()
 RETURNS TABLE(kind text, id text, email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_read_organizational_structure() then
    raise exception 'Only an active user can view organizational structure' using errcode = '42501';
  end if;
  return query
    select 'division'::text, v.id, v.email from public.divisions v where v.organization_id = public.current_organization_id() and v.is_active is not false
    union all
    select 'department'::text, d.id, d.email from public.departments d where d.organization_id = public.current_organization_id() and d.removed_at is null;
end;
$function$;

notify pgrst, 'reload schema';
commit;
