-- SFDA Regulatory Requirements, phase 1: an admin adds a GVP version with its PDF, edits versions,
-- deletes a version that was never current, and adds the PDF to a published version that has none.
--
-- A version an admin adds is kept in a new table, guideline_version_drafts, so it can never become
-- current: current_guideline_version() still reads only guideline_versions and is unchanged, and so
-- are the compliance checks that use it. Making a version current is phase 2.
--
-- Additive: adds one table, three nullable columns on guideline_versions (no existing row changes),
-- one private bucket, its policies and these functions. No existing table, column, row, function,
-- trigger or policy changes. The functions update only name, issued_date, source, storage_path and
-- file_size of a guideline_versions row, never insert or delete one, and delete only from
-- guideline_version_drafts.
-- Undo: supabase/scripts/rollback_guideline_versions_admin.sql

begin;

-- ---------- Published versions: source and PDF ----------

-- The guideline on the SFDA website: an https link on sfda.gov.sa or one of its subdomains.
alter table public.guideline_versions
  add column source text
    constraint guideline_versions_source_check check (
      source is null
      or (length(source) <= 300 and source ~* '^https://([a-z0-9-]+\.)*sfda\.gov\.sa([/?#][^[:space:]]*)?$')
    ),
  -- The PDF in the guideline-files bucket, 'files/<random id>.pdf'. Added once, never replaced.
  add column storage_path text constraint guideline_versions_storage_path_key unique,
  add column file_size bigint constraint guideline_versions_file_size_check check (file_size between 1 and 20971520);

-- ---------- Added versions (never current) ----------

create table public.guideline_version_drafts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and length(name) between 1 and 100),
  version text not null unique check (length(version) <= 20 and version ~ '^[0-9]+\.[0-9]+$'),
  issued_date date not null,
  source text not null check (
    length(source) <= 300 and source ~* '^https://([a-z0-9-]+\.)*sfda\.gov\.sa([/?#][^[:space:]]*)?$'
  ),
  -- e.g. 'Drug-GVP4_0.pdf'
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  storage_path text not null unique,
  file_size bigint not null check (file_size between 1 and 20971520),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.guideline_version_drafts enable row level security;

create policy "Admins can read added guideline versions"
on public.guideline_version_drafts for select to authenticated
using ((select public.can_manage_organization()));

-- No insert, update or delete policies: changes only through the functions below.
revoke all on public.guideline_version_drafts from public, anon, authenticated, service_role;
grant select on public.guideline_version_drafts to authenticated;

-- ---------- File storage ----------

-- Private bucket for guideline PDFs, at most 20 MB each. Read only through signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guideline-files', 'guideline-files', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- Whether no version uses this file yet. Used by the storage policies.
create function public.is_unused_guideline_path(p_path text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.guideline_versions g where g.storage_path = p_path)
     and not exists (select 1 from public.guideline_version_drafts d where d.storage_path = p_path);
$$;

-- An admin uploads a new file, as 'files/<random id>.pdf'. Files are never changed (no update policy).
create policy "Admins can upload guideline files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'guideline-files'
  and name ~ '^files/[0-9a-f-]{36}\.pdf$'
  and (select public.can_manage_organization())
  and public.is_unused_guideline_path(name)
);

create policy "Admins can read guideline files"
on storage.objects for select to authenticated
using (bucket_id = 'guideline-files' and (select public.can_manage_organization()));

-- Only a file no version uses: one left by a failed save, or of a deleted version.
create policy "Admins can remove unused guideline files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'guideline-files'
  and (select public.can_manage_organization())
  and public.is_unused_guideline_path(name)
);

-- ---------- Checks (used by the functions below) ----------

-- A version number as numbers, part by part ({4,10} for '4.10'); null if it isn't digits, a dot, digits.
create function public.guideline_number_parts(p_version text) returns numeric[]
language sql
immutable
set search_path = ''
as $$
  select case when p_version ~ '^[0-9]+\.[0-9]+$'
    then array[pg_catalog.split_part(p_version, '.', 1)::numeric, pg_catalog.split_part(p_version, '.', 2)::numeric]
  end;
$$;

-- The PDF the signed-in admin just uploaded: in guideline-files, uploaded by them, a PDF of at most
-- 20 MB, and not used by any version. Returns its size.
create function public.check_guideline_file(p_storage_path text) returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_object_type text;
  v_object_size bigint;
begin
  if p_storage_path is null or p_storage_path !~ '^files/[0-9a-f-]{36}\.pdf$' then
    raise exception 'The uploaded file was not found' using errcode = 'P0002', hint = 'file-missing';
  end if;
  select o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint
  into v_object_type, v_object_size
  from storage.objects o
  where o.bucket_id = 'guideline-files' and o.name = p_storage_path and o.owner_id = (select auth.uid())::text;
  if not found then
    raise exception 'The uploaded file was not found' using errcode = 'P0002', hint = 'file-missing';
  end if;
  if v_object_type is distinct from 'application/pdf' then
    raise exception 'Only PDF files can be added' using errcode = '23514', hint = 'file-not-pdf';
  end if;
  if v_object_size is null or v_object_size not between 1 and 20971520 then
    raise exception 'The file must be at most 20 MB' using errcode = '23514', hint = 'file-too-large';
  end if;
  if not public.is_unused_guideline_path(p_storage_path) then
    raise exception 'This file is already used by a version' using errcode = '23505', hint = 'file-in-use';
  end if;
  return v_object_size;
end;
$$;

-- The title, SFDA issue date and source, as the form checks them. The issue date can't be after the
-- day the version was added to Hawkim (p_added_date, in Riyadh).
create function public.check_guideline_details(p_name text, p_issued_date date, p_source text, p_added_date date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 100 then
    raise exception 'The title must be 1 to 100 characters' using errcode = '23514', hint = 'title-invalid';
  end if;
  if p_issued_date is null then
    raise exception 'The SFDA issue date is required' using errcode = '23514', hint = 'issued-required';
  end if;
  if p_issued_date > p_added_date then
    raise exception 'The SFDA issue date can''t be after the date it was added' using errcode = '23514', hint = 'issued-after-added';
  end if;
  if p_source is null or length(btrim(p_source)) > 300
     or btrim(p_source) !~* '^https://([a-z0-9-]+\.)*sfda\.gov\.sa([/?#][^[:space:]]*)?$' then
    raise exception 'The source must be an https link on sfda.gov.sa' using errcode = '23514', hint = 'source-invalid';
  end if;
end;
$$;

-- A version number for an added version: digits, a dot, digits; not used by any version (4.0 and
-- 4.00 are the same number); and higher than the current version. p_except: the added version being
-- edited, which may keep its own number.
create function public.check_new_guideline_number(p_version text, p_except uuid) returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_parts numeric[] := public.guideline_number_parts(btrim(p_version));
  v_current_parts numeric[];
begin
  if v_parts is null or length(btrim(p_version)) > 20 then
    raise exception 'The version must be digits, a dot and digits' using errcode = '23514', hint = 'version-invalid';
  end if;
  if exists (select 1 from public.guideline_versions g where public.guideline_number_parts(g.version) = v_parts)
     or exists (
       select 1 from public.guideline_version_drafts d
       where public.guideline_number_parts(d.version) = v_parts and d.id is distinct from p_except
     ) then
    raise exception 'This version already exists' using errcode = '23505', hint = 'version-exists';
  end if;
  select public.guideline_number_parts(g.version) into v_current_parts
  from public.guideline_versions g where g.id = public.current_guideline_version();
  if v_current_parts is not null and v_parts <= v_current_parts then
    raise exception 'The version must be higher than the current version' using errcode = '23514', hint = 'version-not-higher';
  end if;
end;
$$;

-- ---------- Actions ----------

-- Each action takes the same lock as the other admin changes (72441), so it waits for an admin who is
-- removing the caller's Admin permission, then checks it again.

-- Adds a version with the PDF the admin just uploaded. It is not current. Returns its id.
create function public.create_guideline_draft(
  p_name text, p_version text, p_issued_date date, p_source text, p_storage_path text, p_file_name text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file_size bigint;
  v_new_id uuid;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  -- Again, under the lock: another admin may have just removed this caller's Admin.
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  perform public.check_guideline_details(p_name, p_issued_date, p_source, (now() at time zone 'Asia/Riyadh')::date);
  perform public.check_new_guideline_number(p_version, null);
  if p_file_name is null or length(btrim(p_file_name)) not between 1 and 255 or lower(btrim(p_file_name)) not like '%.pdf' then
    raise exception 'Only PDF files can be added' using errcode = '23514', hint = 'file-not-pdf';
  end if;
  v_file_size := public.check_guideline_file(p_storage_path);

  insert into public.guideline_version_drafts (name, version, issued_date, source, file_name, storage_path, file_size, created_by)
  values (btrim(p_name), btrim(p_version), p_issued_date, btrim(p_source), btrim(p_file_name), p_storage_path, v_file_size, (select auth.uid()))
  returning id into v_new_id;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'add-guideline-version', v_new_id::text,
    jsonb_build_object('version', btrim(p_version), 'name', btrim(p_name), 'storage_path', p_storage_path));
  return v_new_id;
end;
$$;

-- Edits an added version: title, version number, SFDA issue date and source. The PDF stays.
create function public.update_guideline_draft(
  p_id uuid, p_name text, p_version text, p_issued_date date, p_source text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.guideline_version_drafts;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  select * into v_existing from public.guideline_version_drafts d where d.id = p_id for update;
  if not found then
    raise exception 'Guideline version not found' using errcode = 'P0002';
  end if;
  perform public.check_guideline_details(p_name, p_issued_date, p_source, (v_existing.created_at at time zone 'Asia/Riyadh')::date);
  perform public.check_new_guideline_number(p_version, v_existing.id);

  update public.guideline_version_drafts d
  set name = btrim(p_name), version = btrim(p_version), issued_date = p_issued_date, source = btrim(p_source), updated_at = now()
  where d.id = v_existing.id;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'update-guideline-version', v_existing.id::text, jsonb_build_object(
    'before', jsonb_build_object('name', v_existing.name, 'version', v_existing.version, 'issued_date', v_existing.issued_date, 'source', v_existing.source),
    'after', jsonb_build_object('name', btrim(p_name), 'version', btrim(p_version), 'issued_date', p_issued_date, 'source', btrim(p_source))
  ));
end;
$$;

-- Edits a published (current or earlier) version: only its title, SFDA issue date and source.
create function public.update_guideline_version(p_id uuid, p_name text, p_issued_date date, p_source text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.guideline_versions;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  select * into v_existing from public.guideline_versions g where g.id = p_id for update;
  if not found then
    raise exception 'Guideline version not found' using errcode = 'P0002';
  end if;
  perform public.check_guideline_details(p_name, p_issued_date, p_source, (v_existing.added_at at time zone 'Asia/Riyadh')::date);

  update public.guideline_versions g
  set name = btrim(p_name), issued_date = p_issued_date, source = btrim(p_source)
  where g.id = v_existing.id;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'update-guideline-version', v_existing.id::text, jsonb_build_object(
    'before', jsonb_build_object('name', v_existing.name, 'issued_date', v_existing.issued_date, 'source', v_existing.source),
    'after', jsonb_build_object('name', btrim(p_name), 'issued_date', p_issued_date, 'source', btrim(p_source))
  ));
end;
$$;

-- Adds the PDF the admin just uploaded to a published version that has none. Its file name stays.
create function public.attach_guideline_file(p_id uuid, p_storage_path text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.guideline_versions;
  v_file_size bigint;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  select * into v_existing from public.guideline_versions g where g.id = p_id for update;
  if not found then
    raise exception 'Guideline version not found' using errcode = 'P0002';
  end if;
  if v_existing.storage_path is not null then
    raise exception 'This version already has a PDF' using errcode = '23505', hint = 'file-exists';
  end if;
  v_file_size := public.check_guideline_file(p_storage_path);

  update public.guideline_versions g
  set storage_path = p_storage_path, file_size = v_file_size
  where g.id = v_existing.id;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'attach-guideline-file', v_existing.id::text,
    jsonb_build_object('storage_path', p_storage_path, 'file_size', v_file_size));
end;
$$;

-- Deletes an added version (never current). Returns its file's path, for the browser to remove.
create function public.delete_guideline_draft(p_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.guideline_version_drafts;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  delete from public.guideline_version_drafts d where d.id = p_id returning d.* into v_existing;
  if not found then
    raise exception 'Guideline version not found' using errcode = 'P0002';
  end if;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'delete-guideline-version', v_existing.id::text,
    jsonb_build_object('version', v_existing.version, 'name', v_existing.name, 'storage_path', v_existing.storage_path));
  return v_existing.storage_path;
end;
$$;

-- ---------- Owner and grants ----------

alter function public.is_unused_guideline_path(text) owner to postgres;
alter function public.guideline_number_parts(text) owner to postgres;
alter function public.check_guideline_file(text) owner to postgres;
alter function public.check_guideline_details(text, date, text, date) owner to postgres;
alter function public.check_new_guideline_number(text, uuid) owner to postgres;
alter function public.create_guideline_draft(text, text, date, text, text, text) owner to postgres;
alter function public.update_guideline_draft(uuid, text, text, date, text) owner to postgres;
alter function public.update_guideline_version(uuid, text, date, text) owner to postgres;
alter function public.attach_guideline_file(uuid, text) owner to postgres;
alter function public.delete_guideline_draft(uuid) owner to postgres;

revoke all on function public.is_unused_guideline_path(text) from public, anon, authenticated, service_role;
revoke all on function public.guideline_number_parts(text) from public, anon, authenticated, service_role;
revoke all on function public.check_guideline_file(text) from public, anon, authenticated, service_role;
revoke all on function public.check_guideline_details(text, date, text, date) from public, anon, authenticated, service_role;
revoke all on function public.check_new_guideline_number(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_guideline_draft(text, text, date, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.update_guideline_draft(uuid, text, text, date, text) from public, anon, authenticated, service_role;
revoke all on function public.update_guideline_version(uuid, text, date, text) from public, anon, authenticated, service_role;
revoke all on function public.attach_guideline_file(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.delete_guideline_draft(uuid) from public, anon, authenticated, service_role;

-- The storage policies call is_unused_guideline_path as the signed-in admin.
grant execute on function public.is_unused_guideline_path(text) to authenticated;
grant execute on function public.create_guideline_draft(text, text, date, text, text, text) to authenticated;
grant execute on function public.update_guideline_draft(uuid, text, text, date, text) to authenticated;
grant execute on function public.update_guideline_version(uuid, text, date, text) to authenticated;
grant execute on function public.attach_guideline_file(uuid, text) to authenticated;
grant execute on function public.delete_guideline_draft(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
