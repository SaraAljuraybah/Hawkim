-- Undoes 20261108150000_department_email.sql. Roll the frontend back first (it sends p_email).
-- Department emails are DROPPED: export them first if they are needed, e.g.
--   select id, name, email from public.departments where email is not null;
-- save_department() returns to its 20261107120100 form and every active user can read every
-- departments column again (the table-wide SELECT grant from 20261025120000).
-- Afterwards: supabase migration repair --status reverted 20261108150000
begin;

drop function if exists public.save_department(text, text, text, text, text, timestamptz, text);

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

revoke all on function public.save_department(text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.save_department(text,text,text,text,text,timestamptz) to authenticated;

-- Back to the table-wide read grant (removes the column grants), then drop the column.
revoke select on public.departments from authenticated;
alter table public.departments drop constraint if exists departments_email_valid;
alter table public.departments drop column if exists email;
grant select on public.departments to authenticated;

notify pgrst, 'reload schema';
commit;
