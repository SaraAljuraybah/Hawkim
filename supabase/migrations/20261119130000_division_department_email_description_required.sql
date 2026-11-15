-- Email and description are required for divisions and departments.
--
-- Add/Edit Division and Add/Edit Department (the dialogs on Divisions and Departments, and the Add/Edit
-- Department page) now require both. save_division and save_department refuse an empty or blank email
-- or description ('Enter an email address' / 'Enter a description', 23514), on create and on edit.
-- The check comes after the existing ones (administrator, duplicate name, stale edit, field formats),
-- so those refusals are unchanged.
--
-- Only these two functions change: no table constraint is added, so existing divisions and departments
-- without an email or description stay valid (they need both on their next edit), and the departments
-- created when an organization is accepted (Pharmacovigilance and Quality Assurance, inserted directly)
-- are unaffected. The bodies are those of 20261116170000_scope_divisions_departments.sql plus the check;
-- the grants are unchanged.

begin;

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
    -- Email and description are required (blank counts as empty); checked last, so the other refusals stay as they were.
    if nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'Enter an email address' using errcode='23514'; end if;
    if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Enter a description' using errcode='23514'; end if;
    target := 'division-' || gen_random_uuid()::text;
    insert into public.divisions(id,name,description,email) values(target,p_name,p_description,p_email);
  else
    select * into old from public.divisions where id = p_id and organization_id = public.current_organization_id() and is_active is not false for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict'; end if;
    -- Email and description are required (blank counts as empty); checked last, so the other refusals stay as they were.
    if nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'Enter an email address' using errcode='23514'; end if;
    if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Enter a description' using errcode='23514'; end if;
    target := p_id;
    update public.divisions set name=p_name,description=p_description,email=p_email where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-division',target);
  return target;
end; $function$;

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
    -- Email and description are required (blank counts as empty); checked last, so the other refusals stay as they were.
    if nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'Enter an email address' using errcode='23514'; end if;
    if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Enter a description' using errcode='23514'; end if;
    target := 'department-' || gen_random_uuid()::text;
    insert into public.departments(id,name,initials,description,division_id,email)
      values(target,btrim(p_name),upper(btrim(p_initials)),btrim(coalesce(p_description,'')),p_division_id,v_email);
  else
    select * into old from public.departments where id=p_id and organization_id = public.current_organization_id() and removed_at is null for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = 'P0001', hint = 'conflict'; end if;
    -- Email and description are required (blank counts as empty); checked last, so the other refusals stay as they were.
    if nullif(btrim(coalesce(p_email,'')),'') is null then raise exception 'Enter an email address' using errcode='23514'; end if;
    if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'Enter a description' using errcode='23514'; end if;
    target := p_id;
    update public.departments set name=btrim(p_name),initials=upper(btrim(p_initials)),description=btrim(coalesce(p_description,'')),
      division_id=p_division_id,email=v_email,updated_at=clock_timestamp() where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-department',target);
  return target;
end; $function$;

commit;
