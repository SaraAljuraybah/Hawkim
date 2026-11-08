-- Departments get an optional email, shown only in the admin portal (Add/Edit Department and the
-- department details dialog on Divisions & Departments).
--
--  * departments.email: optional. Same rules as divisions.email: trimmed, name@domain.tld, up to
--    254 characters, empty saved as null. Not unique. Existing departments keep email = null.
--  * Admin-only, like divisions.email (20261107120100): the table-wide SELECT grant becomes a column
--    grant for every existing column except email. RLS policies are unchanged. Admins read the
--    email through get_divisions_departments(), which already returns every column (to_jsonb(d)).
--  * save_department() is recreated with a 7th parameter, p_email (last, default null). The body
--    is otherwise the 20261107120100 one.
--
-- Apply this BEFORE deploying the frontend that sends p_email.
-- Undo: supabase/scripts/rollback_department_email.sql

begin;

alter table public.departments add column if not exists email text;
alter table public.departments add constraint departments_email_valid check (
  email is null or (length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'));

-- Keep what every active user could already read on departments; only the new email column is withheld.
do $$
declare columns text;
begin
  select string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum) into columns
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.departments'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'email';
  revoke select on public.departments from authenticated;
  execute format('grant select (%s) on public.departments to authenticated', columns);
end;
$$;

drop function public.save_department(text, text, text, text, text, timestamptz);

-- Same limits as the Add/Edit Department form (lib/departmentAdmin.ts, lib/departmentForm.ts): name 1-60,
-- initials 2-3 letters (stored uppercase), description up to 200, unique name and initials,
-- optional email (empty means none).
create function public.save_department(p_id text,p_name text,p_initials text,p_description text,p_division_id text,
  p_expected_updated_at timestamptz default null,p_email text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare target text; old public.departments; v_email text := nullif(btrim(p_email), '');
begin
  if not public.can_manage_organization() then raise exception 'Administrator required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if p_name is null or length(btrim(p_name)) not between 1 and 60
    or p_initials is null or btrim(p_initials) !~ '^[A-Za-z]{2,3}$'
    or length(btrim(coalesce(p_description,''))) > 200
    or (v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')) then
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
    insert into public.departments(id,name,initials,description,division_id,email)
      values(target,btrim(p_name),upper(btrim(p_initials)),btrim(coalesce(p_description,'')),p_division_id,v_email);
  else
    select * into old from public.departments where id=p_id and removed_at is null for update;
    if not found or old.updated_at is distinct from p_expected_updated_at then raise exception 'Organization changed; refresh and try again' using errcode='40001'; end if;
    target := p_id;
    update public.departments set name=btrim(p_name),initials=upper(btrim(p_initials)),description=btrim(coalesce(p_description,'')),
      division_id=p_division_id,email=v_email,updated_at=clock_timestamp() where id=target;
  end if;
  insert into public.organization_management_audit(actor_id,action,entity_id) values(auth.uid(),'save-department',target);
  return target;
end; $$;

revoke all on function public.save_department(text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.save_department(text,text,text,text,text,timestamptz,text) to authenticated;

notify pgrst, 'reload schema';
commit;
