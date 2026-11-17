-- Every active department belongs to a division.
--
-- 0. Division names are unique per organization, among its active divisions (as save_division checks). The live
--    database has an index no migration creates, divisions_name_unique: unique lower(trim(name)) across ALL
--    organizations, deleted divisions included. It keeps two organizations from sharing a division name (and so the
--    default divisions below from being created), and a deleted division's name from being used again. When it exists
--    with exactly that definition it is replaced by divisions_organization_name_unique; any other definition stops the
--    migration. divisions_name_not_blank (also live only: a name can't be blank) is added where it is missing, so local
--    databases match the live one.
-- 1. Existing data: each organization's active default departments that have no division (dhai's, on the live
--    database) go into that organization's default division:
--      Pharmacovigilance  → "Regulatory and Drug Safety"
--      Quality Assurance  → "Quality and Compliance"
--    An active division with that name (ignoring case) is used when the organization already has one; otherwise it
--    is created, with MedCare's description and no email (the email is the organization's own). updated_at of the
--    departments is unchanged. Any other active department without a division stops the migration: nothing is
--    guessed (there is none on the live database).
-- 2. The rule: an active department (removed_at is null) must have a division. Deleted departments are excluded:
--    those deleted before this migration had their division cleared, so it can't be known.
-- 3. accept_access_request: a new organization gets the two default divisions, each with its default department.
--    The divisions are ordinary ones: they can be renamed, and deleted once they have no active department.
-- 4. save_department: an edit can't leave a department without a division either ("Select a division"). The
--    refusal comes before the department is looked up, so it answers the same for any id.
-- 5. delete_department and ack_department_file_deletion (the end of the delete-department Edge Function) keep the
--    deleted department's division instead of clearing it.
--
-- delete_division is unchanged: it only counts active departments (removed_at is null), and it deactivates the
-- division (is_active = false) instead of deleting the row, so the foreign key's "on delete restrict" never applies
-- and deleted departments may keep pointing at it.
--
-- Each function is its latest definition with only the changes above:
--   accept_access_request, save_department, delete_department  20261120120000_default_departments.sql
--   ack_department_file_deletion                               20261116130000_conflict_without_retry.sql
-- CREATE OR REPLACE keeps their owners and grants.
--
-- Undo: supabase/scripts/rollback_departments_always_in_a_division.sql (the functions and the rule; the data, the
-- per-organization name index and divisions_name_not_blank stay; the global name index is not restored).

begin;

-- ---------- 0. Division names: unique per organization ----------
do $$
declare
  v_index text;
  v_check text;
begin
  select pg_catalog.pg_get_indexdef(c.oid) into v_index from pg_catalog.pg_class c
  where c.relname = 'divisions_name_unique' and c.relnamespace = 'public'::regnamespace and c.relkind = 'i';
  if v_index is not null then
    if v_index <> 'CREATE UNIQUE INDEX divisions_name_unique ON public.divisions USING btree (lower(TRIM(BOTH FROM name)))' then
      raise exception '20261124120000: unexpected divisions_name_unique, review it by hand: %', v_index;
    end if;
    drop index public.divisions_name_unique;
    raise notice '20261124120000: divisions_name_unique (one name across all organizations) dropped';
  end if;

  select pg_catalog.pg_get_constraintdef(k.oid) into v_check from pg_catalog.pg_constraint k
  where k.conname = 'divisions_name_not_blank' and k.conrelid = 'public.divisions'::regclass;
  if v_check is null then
    alter table public.divisions add constraint divisions_name_not_blank check (length(trim(both from name)) > 0);
  elsif v_check <> 'CHECK ((length(TRIM(BOTH FROM name)) > 0))' then
    raise exception '20261124120000: unexpected divisions_name_not_blank, review it by hand: %', v_check;
  end if;
end;
$$;

create unique index divisions_organization_name_unique
  on public.divisions (organization_id, lower(btrim(name))) where is_active is not false;

-- ---------- 1. Existing data ----------
do $$
declare
  item record;
  v_name text;
  v_description text;
  v_division text;
  stray text;
begin
  for item in
    select d.id, d.organization_id, d.system_key from public.departments d
    where d.removed_at is null and d.division_id is null and d.system_key is not null
    order by d.organization_id, d.system_key
    for update
  loop
    if item.system_key = 'pharmacovigilance' then
      v_name := 'Regulatory and Drug Safety'; v_description := 'Regulatory Affairs and Drug Safety Division';
    elsif item.system_key = 'quality-assurance' then
      v_name := 'Quality and Compliance'; v_description := 'Governance, Quality Assurance and Compliance Division';
    else
      raise exception '20261124120000: unknown default department % (%)', item.id, item.system_key;
    end if;
    v_division := null;
    select v.id into v_division from public.divisions v
    where v.organization_id = item.organization_id and v.is_active is not false and lower(btrim(v.name)) = lower(v_name)
    order by v.created_at, v.id limit 1;
    if v_division is null then
      v_division := 'division-' || gen_random_uuid()::text;
      insert into public.divisions (id, name, description, organization_id) values (v_division, v_name, v_description, item.organization_id);
      raise notice '20261124120000: organization %: division "%" created', item.organization_id, v_name;
    else
      raise notice '20261124120000: organization %: existing division "%" used', item.organization_id, v_name;
    end if;
    update public.departments set division_id = v_division where id = item.id;
  end loop;

  select string_agg(d.id || ' (organization ' || d.organization_id || ')', ', ' order by d.id) into stray
  from public.departments d where d.removed_at is null and d.division_id is null;
  if stray is not null then
    raise exception '20261124120000: active departments without a division, to be placed by hand first: %', stray;
  end if;
end;
$$;

-- ---------- 2. The rule ----------
alter table public.departments add constraint departments_active_division_required
  check (removed_at is not null or division_id is not null);

-- ---------- 3. A new organization's default divisions ----------
-- The body of 20261120120000_default_departments.sql; the two divisions are added and each department is put in one.
create or replace function public.accept_access_request(p_id uuid, p_token_hash text, p_user_id uuid, p_department text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.access_requests;
  words text[];
  initials text;
  v_name text;
  v_organization uuid;
  v_safety_division text := 'division-' || gen_random_uuid()::text;
  v_quality_division text := 'division-' || gen_random_uuid()::text;
begin
  -- p_department: sent by older Edge Functions; unused (an Admin has no department).
  request := public.lock_pending_access_request(p_id, p_token_hash);

  -- One account belongs to one organization: an account that has a profile anywhere can't start another.
  if exists (select 1 from public.profiles p where p.email = request.email and p.deleted_at is null)
     or exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'email_in_use' using errcode = 'P0001';
  end if;

  v_name := pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(request.organization, ''), '[[:cntrl:]]+', ' ', 'g')), 200);
  if v_name = '' then
    raise exception 'invalid_organization_details' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, access_request_id) values (v_name, request.id) returning id into v_organization;
  perform public.lock_organization_changes(v_organization);

  -- The Organization Profile from the request. In its own block: a value the profile refuses is left empty,
  -- and the request is still accepted.
  begin
    update public.organizations o set
      email = request.organization_email, description = request.organization_description,
      address = request.organization_address, maps_url = request.organization_maps_url,
      website = request.organization_website, updated_at = pg_catalog.now()
    where o.id = v_organization;
  exception when integrity_constraint_violation or data_exception then
    raise notice 'accept_access_request: the organization details of request % were not copied (%)', request.id, sqlerrm;
  end;

  -- Its two default divisions (20261124120000): ordinary divisions, with MedCare's descriptions and no email (the
  -- organization's own).
  insert into public.divisions (id, name, description, organization_id) values
    (v_safety_division, 'Regulatory and Drug Safety', 'Regulatory Affairs and Drug Safety Division', v_organization),
    (v_quality_division, 'Quality and Compliance', 'Governance, Quality Assurance and Compliance Division', v_organization);

  -- Its two default departments (20261120120000: protected, marked with their system keys), one in each default
  -- division, and no regulatory guideline: the organization starts with none, and an Admin adds its own.
  insert into public.departments (id, name, initials, description, is_quality, requires_compliance_check, organization_id, system_key, division_id) values
    ('department-' || gen_random_uuid()::text, 'Pharmacovigilance', 'PV', '', false, true, v_organization, 'pharmacovigilance', v_safety_division),
    ('department-' || gen_random_uuid()::text, 'Quality Assurance', 'QA', '', true, false, v_organization, 'quality-assurance', v_quality_division);

  -- The applicant: an Admin, with no department and no position (as in 20261112140000).
  words := regexp_split_to_array(request.contact_name, '\s+');
  initials := upper(case
    when array_length(words, 1) >= 2 then left(words[1], 1) || left(words[array_length(words, 1)], 1)
    else left(words[1], 2)
  end);
  insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id)
  values (p_user_id, request.contact_name, request.email, initials, null, request.phone, null, v_organization);
  insert into public.user_roles (user_id, role) values (p_user_id, 'admin');

  -- The organization's Super Admin.
  update public.organizations o set super_admin_id = p_user_id, super_admin_assigned_at = now() where o.id = v_organization;

  update public.access_requests r
  set status = 'accepted', user_id = p_user_id, decided_at = now(), organization_id = v_organization
  where r.id = request.id;
end;
$$;

-- ---------- 4. save_department: a division on edit too ----------
-- The body of 20261120120000_default_departments.sql; "Select a division" now applies to an edit as well.
create or replace function public.save_department(p_id text, p_name text, p_initials text, p_description text, p_division_id text,
  p_expected_updated_at timestamp with time zone default null, p_email text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
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
  -- 20261124120000: every department has a division, new or edited.
  if p_division_id is null then raise exception 'Select a division' using errcode='23514'; end if;
  if exists(select 1 from public.departments where organization_id = public.current_organization_id() and removed_at is null and id is distinct from p_id
    and (lower(btrim(name))=lower(btrim(p_name)) or upper(btrim(initials))=upper(btrim(p_initials)))) then
    raise exception 'Department name or initials already exists' using errcode='23505';
  end if;
  if p_id is null then
    -- Email and description are required (blank counts as empty); checked last, so the other refusals stay as they were.
    if nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'Enter an email address' using errcode='23514'; end if;
    if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Enter a description' using errcode='23514'; end if;
    target := 'department-' || gen_random_uuid()::text;
    insert into public.departments(id,name,initials,description,division_id,email)
      values(target,btrim(p_name),upper(btrim(p_initials)),btrim(coalesce(p_description,'')),p_division_id,v_email);
  else
    select * into old from public.departments where id=p_id and organization_id = public.current_organization_id() and removed_at is null for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict'; end if;
    -- 20261120120000: a default department keeps its name (and the initials generated from it).
    if old.system_key is not null and (btrim(p_name) is distinct from old.name or upper(btrim(p_initials)) is distinct from old.initials) then
      raise exception 'A default department''s name can''t be changed' using errcode = '23514', hint = 'default-department';
    end if;
    -- Email and description are required (blank counts as empty); checked last, so the other refusals stay as they were.
    if nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'Enter an email address' using errcode='23514'; end if;
    if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Enter a description' using errcode='23514'; end if;
    target := p_id;
    update public.departments set name=btrim(p_name),initials=upper(btrim(p_initials)),description=btrim(coalesce(p_description,'')),
      division_id=p_division_id,email=v_email,updated_at=clock_timestamp() where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-department',target);
  return target;
end; $$;

-- ---------- 5. Deleting a department keeps its division ----------
-- The body of 20261120120000_default_departments.sql; the deleted department keeps its division_id.
create or replace function public.delete_department(p_id text, p_sop_action text, p_expected_updated_at timestamp with time zone)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare old public.departments; ids uuid[];
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_sop_action='delete' then raise exception 'Permanent file deletion requires the secure cleanup endpoint' using errcode='23514'; end if;
  if p_sop_action is null or p_sop_action not in ('empty','others') then raise exception 'Choose how to handle SOPs' using errcode='23514'; end if;
  perform public.lock_organization_changes(public.current_organization_id());
  select * into old from public.departments where id=p_id and organization_id = public.current_organization_id() and removed_at is null for update;
  if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict'; end if;
  -- 20261120120000: the organization's default departments stay.
  if old.system_key is not null then
    raise exception 'Default departments cannot be deleted.' using errcode = 'P0001', hint = 'default-department';
  end if;
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
  -- 20261124120000: the deleted department keeps its division.
  update public.departments set removed_at=now(),updated_at=clock_timestamp() where id=p_id;
  insert into public.organization_management_audit(actor_id,action,entity_id,details)
    values(auth.uid(),'delete-department',p_id,jsonb_build_object('sopAction',p_sop_action,'sopIds',coalesce(to_jsonb(ids),'[]')));
end; $$;

-- The body of 20261116130000_conflict_without_retry.sql; the deleted department keeps its division_id.
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
    raise exception 'Deletion lease changed' using errcode = 'P0001', hint = 'conflict';
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
    -- 20261124120000: the deleted department keeps its division.
    update public.departments set removed_at=now(),updated_at=clock_timestamp() where id=job.department_id;
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

notify pgrst, 'reload schema';

commit;
