-- Divisions & Departments 2/4: management API. Reconciled from the feat/divisions-departments
-- migration 20261105120200. Requires 20261107120000. See docs/divisions-departments.md.
--
-- Additive management API for divisions and departments (admin only, can_manage_organization()).
-- Existing ids, mappings, files and workflow history are kept.
--
-- Corrections against the Hawkim-1 original:
--  * Division email is OPTIONAL from the start (was required, then relaxed in 20261105160001).
--  * The new divisions.email column is not readable directly by every active user: develop's
--    table-wide SELECT grant becomes a column grant for exactly the columns that exist now, minus
--    email. Develop's RLS policies and get_organizational_structure() are unchanged.
--  * get_divisions_departments() moved to 20261107120300 (it needs employee_positions) and delete_department()
--    to 20261107120200 (it needs the file-cleanup outbox), so each is defined once, in its final form.
--  * A retained (soft-deleted) SOP can't be hard-deleted (guard_retained_sop_delete), so develop's
--    delete_sop() can't remove the audit evidence a department deletion keeps. delete_sop() itself
--    is not changed: for any other SOP it behaves exactly as before.
--  * can_view_sop()/can_view_version() are develop's current bodies
--    (20261102130000_other_department_reviewers.sql) plus "s.deleted_at is null", nothing else.
--  * Indexes use IF NOT EXISTS.

begin;

alter table public.divisions add column if not exists email text;
alter table public.departments add column if not exists updated_at timestamptz not null default now();
alter table public.sops add column if not exists deleted_at timestamptz;
alter table public.sops add column if not exists directory_group text not null default 'department'
  check (directory_group in ('department', 'others'));
create index if not exists sops_live_department on public.sops(department_id) where deleted_at is null;

-- Keep what every active user could already read on divisions; only the new email column is withheld
-- (admins read it through get_divisions_departments()).
do $$
declare columns text;
begin
  select string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum) into columns
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.divisions'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'email';
  revoke select on public.divisions from authenticated;
  execute format('grant select (%s) on public.divisions to authenticated', columns);
end;
$$;

-- Division fields: name 1-100, optional email (empty means none), description up to 500.
create or replace function public.validate_division_management() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  new.email := nullif(btrim(new.email), '');
  new.description := btrim(coalesce(new.description, ''));
  if new.name is null or length(new.name) not between 1 and 100
    or (new.email is not null and (length(new.email) > 254
      or new.email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
    or length(new.description) > 500 then
    raise exception 'Invalid division fields' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end; $$;
create trigger divisions_management_validation before insert or update of name, email, description
on public.divisions for each row execute function public.validate_division_management();

-- Serialize assignments with department removal, including dashboard/service writes.
-- (20261107120200 replaces it to also refuse departments whose file cleanup is pending.)
create or replace function public.guard_active_department() returns trigger
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

create table if not exists public.organization_management_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles(id),
  action text not null, entity_id text not null, details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.organization_management_audit enable row level security;
revoke all on public.organization_management_audit from public, anon, authenticated;

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

-- Same limits as the Add/Edit Department form (lib/departmentAdmin.ts): name 1-60,
-- initials 2-3 letters (stored uppercase), description up to 200, unique name and initials.
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

revoke all on function public.validate_division_management(),public.guard_active_department() from public,anon,authenticated;
revoke all on function public.save_division(text,text,text,text,timestamptz), public.delete_division(text,timestamptz),
 public.save_department(text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.save_division(text,text,text,text,timestamptz), public.delete_division(text,timestamptz),
 public.save_department(text,text,text,text,text,timestamptz) to authenticated;

-- Develop's current bodies (20261102130000_other_department_reviewers.sql) + "s.deleted_at is null".
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
-- A retained SOP's row is audit evidence: develop's delete_sop() (which deletes children first and
-- the SOP last) is rolled back as a whole instead of erasing it. Other SOPs are unaffected.
create function public.guard_retained_sop_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.deleted_at is not null then raise exception 'This SOP has been deleted' using errcode='23514'; end if;
  return old;
end; $$;
create trigger sops_deleted_guard before update on public.sops for each row execute function public.guard_deleted_sop_update();
create trigger sops_retained_delete_guard before delete on public.sops for each row execute function public.guard_retained_sop_delete();
do $$
declare target text;
begin
  foreach target in array array['sop_versions','sop_co_authors','review_rounds','review_requests','compliance_checks','sop_comments','timeline_events'] loop
    execute format('create trigger retained_sop_guard before insert or update on public.%I for each row execute function public.guard_retained_sop()',target);
  end loop;
end; $$;
revoke all on function public.guard_retained_sop(),public.guard_deleted_sop_update(),public.guard_retained_sop_delete() from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
