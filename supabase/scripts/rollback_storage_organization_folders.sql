-- Undoes supabase/migrations/20261116230000_storage_organization_folders.sql: the paths without the
-- organization's folder, and the functions as they were before it (pg_get_functiondef). Run as the owner
-- (postgres), only while MedCare is the only organization, and only after moving the files back out of
-- the organization's folder (the move script, run in reverse).
begin;

drop policy "Organization folder only" on storage.objects;

drop policy "Authors can upload SOP files to their own folder" on storage.objects;
create policy "Authors can upload SOP files to their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sop-files'
  and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.(pdf|docx)$')
  and (select public.has_role('author'))
);

drop policy "Admins can upload guideline files" on storage.objects;
create policy "Admins can upload guideline files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'guideline-files'
  and name ~ '^files/[0-9a-f-]{36}\.pdf$'
  and (select public.can_manage_organization())
  and public.is_unused_guideline_path(name)
);

drop function public.relocate_storage_path(text, text, text);

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
     or p_storage_path !~ ('^' || (select auth.uid())::text || '/[0-9a-f-]{36}\.' || name_type::text || '$') then
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
$function$

;

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
$function$

;

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
  if p_index_path is null or p_index_path !~ '^versions/[0-9a-f-]{36}$' then
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
$function$

;

CREATE OR REPLACE FUNCTION public.guard_retained_sop()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare archived timestamptz;
begin
  select deleted_at into archived from public.sops where id=new.sop_id for update;
  if archived is not null then
    raise exception 'This SOP has been deleted' using errcode='23514';
  end if;
  return new;
end; $function$
;

notify pgrst, 'reload schema';
commit;
