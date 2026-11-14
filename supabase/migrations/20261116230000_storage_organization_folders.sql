-- Multi-tenant, step 11: every stored file is in its organization's folder.
--
-- New paths (the first folder is the organization's id):
--   sop-files          <organization>/<user>/<random id>.pdf|docx   (was <user>/<random id>.pdf|docx)
--   guideline-files    <organization>/files/<random id>.pdf          (was files/<random id>.pdf)
--   guideline-indexes  <organization>/versions/<version id>/...      (was versions/<version id>/...)
--
-- 1. One RESTRICTIVE policy on storage.objects, "Organization folder only": for sop-files and
--    guideline-files, every read, upload and delete through the API is limited to the caller's
--    organization's folder (current_organization_id()), whatever the other policies allow. guideline-indexes
--    has no policies at all (only the service role reads and writes it), as before.
-- 2. The upload policies and the checks of a just-uploaded file expect the new paths; the compliance
--    service must store a version's index in <organization>/versions/<version id>.
-- 3. relocate_storage_path(bucket, old, new): for the one-time move of the existing files
--    (supabase/scripts/move_storage_to_organizations.mjs, service role only). It points the rows that use a
--    file to its new path, only when the new path is the old one in the row's organization's folder.
--
-- The existing files must be moved together with this migration (the release steps): until a file is
-- moved, the website can't read it, because its path isn't in an organization's folder.
-- check_sop_file, check_guideline_file, complete_guideline_processing and guard_retained_sop are their LATEST
-- definitions (pg_get_functiondef) with only the changes named above them.
--
-- Undo: supabase/scripts/rollback_storage_organization_folders.sql

begin;

-- ---------- 1. The organization's folder only ----------

create policy "Organization folder only" on storage.objects as restrictive for all to public
  using (bucket_id not in ('sop-files', 'guideline-files')
         or (storage.foldername(name))[1] = (select public.current_organization_id())::text)
  with check (bucket_id not in ('sop-files', 'guideline-files')
              or (storage.foldername(name))[1] = (select public.current_organization_id())::text);

-- ---------- 2. Uploads in the new paths ----------

drop policy "Authors can upload SOP files to their own folder" on storage.objects;
create policy "Authors can upload SOP files to their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sop-files'
  and name ~ ('^' || (select public.current_organization_id())::text || '/' || (select auth.uid())::text
              || '/[0-9a-f-]{36}\.(pdf|docx)$')
  and (select public.has_role('author'))
);

drop policy "Admins can upload guideline files" on storage.objects;
create policy "Admins can upload guideline files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'guideline-files'
  and name ~ ('^' || (select public.current_organization_id())::text || '/files/[0-9a-f-]{36}\.pdf$')
  and (select public.can_manage_organization())
  and public.is_unused_guideline_path(name)
);

-- check_sop_file: the file must be in the caller's folder of their organization, <organization>/<user>/<random id>.pdf|docx.
CREATE OR REPLACE FUNCTION public.check_sop_file(p_storage_path text, p_file_name text)
 RETURNS TABLE(file_type sop_file_type, file_size bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  name_type public.sop_file_type;
  expected_type text;
  object_type text;
  object_size bigint;
begin
  if p_file_name is null or length(btrim(p_file_name)) not between 1 and 255 then
    raise exception 'The file name must be 1 to 255 characters' using errcode = 'check_violation';
  end if;
  name_type := case
    when lower(btrim(p_file_name)) like '%.pdf' then 'pdf'
    when lower(btrim(p_file_name)) like '%.docx' then 'docx'
  end;
  if name_type is null then
    raise exception 'Only PDF and DOCX files can be uploaded' using errcode = 'check_violation';
  end if;
  if p_storage_path is null
     or p_storage_path !~ ('^' || public.current_organization_id()::text || '/' || (select auth.uid())::text
       || '/[0-9a-f-]{36}\.' || name_type::text || '$') then
    raise exception 'The file is not in your upload folder' using errcode = 'check_violation';
  end if;

  select o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint
  into object_type, object_size
  from storage.objects o
  where o.bucket_id = 'sop-files' and o.name = p_storage_path and o.owner_id = (select auth.uid())::text;
  if not found then
    raise exception 'The uploaded file was not found' using errcode = 'no_data_found';
  end if;
  -- Worked out first: inside an IF condition, a CASE's own THEN would end the condition.
  if name_type = 'pdf' then
    expected_type := 'application/pdf';
  else
    expected_type := 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  end if;
  if object_type is distinct from expected_type then
    raise exception 'The file type does not match its name' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.sop_versions v where v.storage_path = p_storage_path) then
    raise exception 'This file is already used by a version' using errcode = 'unique_violation';
  end if;

  return query select name_type, object_size;
end;
$function$;

-- check_guideline_file: the file must be in the caller's organization's folder, <organization>/files/<random id>.pdf.
CREATE OR REPLACE FUNCTION public.check_guideline_file(p_storage_path text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_object_type text;
  v_object_size bigint;
begin
  if p_storage_path is null
     or p_storage_path !~ ('^' || public.current_organization_id()::text || '/files/[0-9a-f-]{36}\.pdf$') then
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
$function$;

-- complete_guideline_processing: the index must be in the version's own folder, <organization>/versions/<version id>.
CREATE OR REPLACE FUNCTION public.complete_guideline_processing(p_id uuid, p_index_path text, p_report jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  draft public.guideline_version_drafts;
  passages jsonb;
  new_id uuid;
begin
  if p_index_path is null or p_index_path is distinct from (
    select d.organization_id::text || '/versions/' || d.id::text from public.guideline_version_drafts d where d.id = p_id) then
    raise exception 'Invalid index path' using errcode = '22023';
  end if;
  update public.guideline_version_drafts
  set processing_status = 'ready', processed_at = now(), index_path = p_index_path,
      processing_report = coalesce(p_report, '{}'::jsonb), processing_error = null
  where id = p_id and processing_status = 'processing' and not cancel_requested
  returning * into draft;
  if not found then
    raise exception 'This version is not being processed' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.guideline_versions g
             where g.organization_id = draft.organization_id and g.name = draft.name and g.version = draft.version) then
    return;
  end if;

  -- Read before the draft row (and with it its passages) is deleted.
  passages := public.guideline_draft_passages(draft.id);
  delete from public.guideline_version_drafts where id = draft.id;
  insert into public.guideline_versions
    (organization_id, name, version, issued_date, effective_date, file_name, added_by, source, storage_path, file_size,
     index_path, draft_id, processing_report)
  values
    (draft.organization_id, draft.name, draft.version, draft.issued_date, (now() at time zone 'Asia/Riyadh')::date, draft.file_name,
     draft.created_by, draft.source, draft.storage_path, draft.file_size,
     draft.index_path, draft.id, draft.processing_report)
  returning id into new_id;
  perform public.upsert_guideline_requirements(new_id, passages);
end;
$function$;

-- guard_retained_sop: while relocate_storage_path moves a file into its organization's folder, a deleted SOP's version may change its storage_path, and nothing else (never through the API).
CREATE OR REPLACE FUNCTION public.guard_retained_sop()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare archived timestamptz;
begin
  select deleted_at into archived from public.sops where id=new.sop_id for update;
  if archived is not null and not (
    tg_op = 'UPDATE' and tg_table_name = 'sop_versions' and not public.is_api_user_request()
    and coalesce(pg_catalog.current_setting('hawkim.relocating_storage', true), '') = 'on'
    and (pg_catalog.to_jsonb(new) - 'storage_path') = (pg_catalog.to_jsonb(old) - 'storage_path')) then
    raise exception 'This SOP has been deleted' using errcode='23514';
  end if;
  return new;
end; $function$;

-- ---------- 3. Moving the existing files ----------

-- For the one-time move (service role): the rows that use the file p_old_path in p_bucket now use
-- p_new_path, which must be p_old_path in the row's organization's folder. Returns how many rows changed
-- (0: no row uses it, or the new path isn't its organization's folder).
create function public.relocate_storage_path(p_bucket text, p_old_path text, p_new_path text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  changed integer := 0;
  n integer;
begin
  if p_old_path is null or p_new_path is null or btrim(p_old_path) = '' then
    raise exception 'Both paths are required' using errcode = '22023';
  end if;
  -- Lets guard_retained_sop accept the storage_path of a deleted SOP's version (this transaction only).
  perform pg_catalog.set_config('hawkim.relocating_storage', 'on', true);
  if p_bucket = 'sop-files' then
    update public.sop_versions v set storage_path = p_new_path
    where v.storage_path = p_old_path and p_new_path = v.organization_id::text || '/' || p_old_path;
    get diagnostics n = row_count; changed := changed + n;
    update public.department_file_deletion_items i set storage_path = p_new_path
    where i.bucket_id = 'sop-files' and i.storage_path = p_old_path and p_new_path = i.organization_id::text || '/' || p_old_path;
    get diagnostics n = row_count; changed := changed + n;
  elsif p_bucket = 'guideline-files' then
    update public.guideline_versions g set storage_path = p_new_path
    where g.storage_path = p_old_path and p_new_path = g.organization_id::text || '/' || p_old_path;
    get diagnostics n = row_count; changed := changed + n;
    update public.guideline_version_drafts d set storage_path = p_new_path
    where d.storage_path = p_old_path and p_new_path = d.organization_id::text || '/' || p_old_path;
    get diagnostics n = row_count; changed := changed + n;
  elsif p_bucket = 'guideline-indexes' then
    -- An index is a folder: the versions whose index_path is it.
    update public.guideline_versions g set index_path = p_new_path
    where g.index_path = p_old_path and p_new_path = g.organization_id::text || '/' || p_old_path;
    get diagnostics n = row_count; changed := changed + n;
    update public.guideline_version_drafts d set index_path = p_new_path
    where d.index_path = p_old_path and p_new_path = d.organization_id::text || '/' || p_old_path;
    get diagnostics n = row_count; changed := changed + n;
  else
    raise exception 'Unknown bucket %', p_bucket using errcode = '22023';
  end if;
  perform pg_catalog.set_config('hawkim.relocating_storage', '', true);
  return changed;
end;
$$;

alter function public.relocate_storage_path(text, text, text) owner to postgres;
revoke all on function public.relocate_storage_path(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.relocate_storage_path(text, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
