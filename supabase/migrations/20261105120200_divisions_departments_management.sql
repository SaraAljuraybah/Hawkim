-- Additive management API. Existing mappings, identities, files and workflow history are retained.
begin;
alter table public.divisions add column if not exists email text;
alter table public.departments add column if not exists updated_at timestamptz not null default now();
alter table public.sops add column if not exists deleted_at timestamptz;
alter table public.sops add column if not exists directory_group text not null default 'department'
  check (directory_group in ('department', 'others'));
create index sops_live_department on public.sops(department_id) where deleted_at is null;

-- Legacy missing emails are deliberately left null. Every new/edited division must supply one.
create function public.validate_division_management() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  new.email := btrim(new.email);
  new.description := btrim(coalesce(new.description, ''));
  if new.name is null or length(new.name) not between 1 and 100
    or new.email is null or length(new.email) > 254
    or new.email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or length(new.description) > 500 then
    raise exception 'Invalid division fields' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end; $$;
create trigger divisions_management_validation before insert or update of name, email, description
on public.divisions for each row execute function public.validate_division_management();

-- Serialize assignments with department removal, including dashboard/service writes.
create function public.guard_active_department() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.departments d where d.id = new.department_id
    and d.removed_at is null for share) then
    raise exception 'Department is no longer available' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger profiles_active_department before insert or update of department_id on public.profiles
for each row execute function public.guard_active_department();
create trigger sops_active_department before insert or update of department_id on public.sops
for each row execute function public.guard_active_department();

create table public.organization_management_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  action text not null, entity_id text not null, details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.organization_management_audit enable row level security;
revoke all on public.organization_management_audit from public, anon, authenticated;

create function public.get_divisions_departments() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_read_organizational_structure() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  return (
    with roles as (
      select user_id,jsonb_agg(role order by role) as permissions from public.user_roles group by user_id
    ), employees as (
      select p.department_id, count(*) as n, jsonb_agg(jsonb_build_object(
        'id',p.id,'name',p.full_name,'email',p.email,'initials',p.initials,'departmentId',p.department_id,
        'permissions',coalesce(r.permissions,'[]')) order by p.full_name,p.id) as people
      from public.profiles p left join roles r on r.user_id=p.id where p.deleted_at is null group by p.department_id
    ), status_totals as (
      select department_id,status,count(*) as n from public.sops where deleted_at is null and directory_group='department' group by department_id,status
    ), status_counts as (
      select department_id,jsonb_object_agg(status,n) as counts from status_totals group by department_id
    ), documents as (
      select department_id, count(*) as n from public.sops where deleted_at is null and directory_group = 'department' group by department_id
    )
    select jsonb_build_object(
      'divisions', (select coalesce(jsonb_agg(to_jsonb(v) order by v.name, v.id), '[]')
        from public.divisions v where v.is_active is not false),
      'departments', (select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object(
        'employees', coalesce(e.n,0), 'people',coalesce(e.people,'[]'), 'sops', coalesce(s.n,0), 'status_counts',coalesce(c.counts,'{}')) order by d.name, d.id), '[]')
        from public.departments d left join employees e on e.department_id = d.id
        left join documents s on s.department_id = d.id left join status_counts c on c.department_id=d.id where d.removed_at is null)
    )
  );
end; $$;

create function public.save_division(p_id text, p_name text, p_description text, p_email text, p_expected_updated_at timestamptz default null)
returns text language plpgsql security definer set search_path = '' as $$
declare target text; old public.divisions;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if exists(select 1 from public.divisions where is_active is not false and lower(btrim(name)) = lower(btrim(p_name)) and id is distinct from p_id) then
    raise exception 'Division name already exists' using errcode = '23505';
  end if;
  if p_id is null then
    target := 'division-' || gen_random_uuid()::text;
    insert into public.divisions(id,name,description,email) values(target,p_name,p_description,p_email);
  else
    select * into old from public.divisions where id = p_id and is_active is not false for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = '40001'; end if;
    target := p_id;
    update public.divisions set name=p_name,description=p_description,email=p_email where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-division',target);
  return target;
end; $$;

create function public.delete_division(p_id text, p_expected_updated_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare old public.divisions;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into old from public.divisions where id=p_id and is_active is not false for update;
  if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode = '40001'; end if;
  if exists(select 1 from public.departments where division_id=p_id and removed_at is null) then
    raise exception 'Divisions with assigned departments cannot be deleted.' using errcode='23503';
  end if;
  update public.divisions set is_active=false,updated_at=clock_timestamp() where id=p_id;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'delete-division',p_id);
end; $$;

create function public.save_department(p_id text,p_name text,p_initials text,p_description text,p_division_id text,p_expected_updated_at timestamptz default null)
returns text language plpgsql security definer set search_path = '' as $$
declare target text; old public.departments;
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if p_name is null or length(btrim(p_name)) not between 1 and 60
    or p_initials is null or btrim(p_initials) !~ '^[A-Za-z]{2,3}$'
    or length(btrim(coalesce(p_description,''))) > 200 then
    raise exception 'Invalid department fields' using errcode='23514';
  end if;
  if p_division_id is not null and not exists(select 1 from public.divisions where id=p_division_id and is_active is not false for share) then
    raise exception 'Select an active division' using errcode='23514';
  end if;
  -- New departments require a division; legacy unassigned departments can stay unassigned.
  if p_id is null and p_division_id is null then raise exception 'Select a division' using errcode='23514'; end if;
  if exists(select 1 from public.departments where removed_at is null and id is distinct from p_id
    and (lower(btrim(name))=lower(btrim(p_name)) or upper(btrim(initials))=upper(btrim(p_initials)))) then
    raise exception 'Department name or initials already exists' using errcode='23505';
  end if;
  if p_id is null then
    target := 'department-' || gen_random_uuid()::text;
    insert into public.departments(id,name,initials,description,division_id)
      values(target,btrim(p_name),upper(btrim(p_initials)),btrim(coalesce(p_description,'')),p_division_id);
  else
    select * into old from public.departments where id=p_id and removed_at is null for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode='40001'; end if;
    target := p_id;
    update public.departments set name=btrim(p_name),initials=upper(btrim(p_initials)),description=btrim(coalesce(p_description,'')),
      division_id=p_division_id,updated_at=clock_timestamp() where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-department',target);
  return target;
end; $$;

-- Canonical whole-SOP deletion follows the existing retained-file / soft-deleted-version policy.
-- No child tables or storage objects are cascaded. Open workflows must be settled first.
create function public.delete_department(p_id text,p_sop_action text,p_expected_updated_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare old public.departments; ids uuid[];
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  if p_sop_action is null or p_sop_action not in ('empty','delete','others') then raise exception 'Choose how to handle SOPs' using errcode='23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into old from public.departments where id=p_id and removed_at is null for update;
  if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode='40001'; end if;
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
  if p_sop_action='delete' then
    update public.sop_versions set deleted_at=coalesce(deleted_at,now()),deleted_by=coalesce(deleted_by,auth.uid()) where sop_id=any(ids);
    update public.sops set deleted_at=now(),updated_at=now() where id=any(ids);
  elsif p_sop_action='others' then
    -- The department is a historical tombstone, not an active directory assignment.
    -- Retain its FK for confidentiality and workflow evidence; do not invent a department.
    update public.sops set directory_group='others',updated_at=now() where id=any(ids);
  end if;
  update public.departments set removed_at=now(),division_id=null,updated_at=clock_timestamp() where id=p_id;
  insert into public.organization_management_audit(actor_id,action,entity_id,details)
    values(auth.uid(),'delete-department',p_id,jsonb_build_object('sopAction',p_sop_action,'sopIds',coalesce(to_jsonb(ids),'[]')));
end; $$;

revoke all on function public.validate_division_management(),public.guard_active_department() from public,anon,authenticated;
revoke all on function public.get_divisions_departments(), public.save_division(text,text,text,text,timestamptz),
 public.delete_division(text,timestamptz), public.save_department(text,text,text,text,text,timestamptz),
 public.delete_department(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.get_divisions_departments(), public.save_division(text,text,text,text,timestamptz),
 public.delete_division(text,timestamptz), public.save_department(text,text,text,text,text,timestamptz),
 public.delete_department(text,text,timestamptz) to authenticated;

create or replace function public.can_view_sop(p_sop_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null
    where s.id = p_sop_id and s.deleted_at is null
      and (
        s.author_id = p.id
        or public.is_co_author(s.id, p.id)
        or (s.status = 'published' and s.department_id = p.department_id)
        or (exists (select 1 from public.review_requests q where q.sop_id = s.id and q.reviewer_id = p.id)
            and not public.reviewer_lost_access(s.id, p.id))
      )
  );
$$;
create or replace function public.can_view_version(p_sop_id uuid, p_version integer) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null
    where s.id = p_sop_id and s.deleted_at is null
      and (
        s.author_id = p.id
        or public.is_co_author(s.id, p.id)
        or (s.status = 'published' and s.department_id = p.department_id)
        or (exists (
          select 1 from public.review_requests q
          join public.review_rounds r on r.id = q.round_id
          where q.sop_id = s.id and q.reviewer_id = p.id and r.version = p_version
        ) and not public.reviewer_lost_access(s.id, p.id))
      )
  );
$$;
-- Retained SOPs cannot be changed through an older RPC after deletion.
create function public.guard_retained_sop() returns trigger
language plpgsql security definer set search_path = '' as $$
declare archived timestamptz;
begin
  select deleted_at into archived from public.sops where id=new.sop_id for update;
  if archived is not null then
    raise exception 'This SOP has been deleted' using errcode='23514';
  end if;
  return new;
end; $$;
create function public.guard_deleted_sop_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.deleted_at is not null then raise exception 'This SOP has been deleted' using errcode='23514'; end if;
  return new;
end; $$;
create trigger sops_deleted_guard before update on public.sops for each row execute function public.guard_deleted_sop_update();
do $$
declare target text;
begin
  foreach target in array array['sop_versions','sop_co_authors','review_rounds','review_requests','compliance_checks','sop_comments','timeline_events'] loop
    execute format('create trigger retained_sop_guard before insert or update on public.%I for each row execute function public.guard_retained_sop()',target);
  end loop;
end; $$;
revoke all on function public.guard_retained_sop(),public.guard_deleted_sop_update() from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
