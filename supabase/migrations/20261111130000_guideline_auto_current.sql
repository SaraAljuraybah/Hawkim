-- SFDA Regulatory Requirements, phase 2: a processed GVP version becomes current automatically.
--
-- When the compliance service finishes processing an added version, complete_guideline_processing
-- now publishes it straight away: it becomes the newest guideline_versions row (so
-- current_guideline_version() returns it), with its index path and processing report, and the draft
-- row is removed. guideline_versions.draft_id remembers which added version it came from, so the
-- added version's page can move to it. If the name and version number are already published, the
-- version stays 'ready' instead (an admin can still use Make Current after fixing the number).
--
-- Additive: two columns on guideline_versions; complete_guideline_processing and
-- make_guideline_current keep their signatures.

begin;

alter table public.guideline_versions
  add column draft_id uuid unique,
  add column processing_report jsonb;

create or replace function public.complete_guideline_processing(p_id uuid, p_index_path text, p_report jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.guideline_version_drafts;
begin
  if p_index_path is null or p_index_path !~ '^versions/[0-9a-f-]{36}$' then
    raise exception 'Invalid index path' using errcode = '22023';
  end if;
  update public.guideline_version_drafts
  set processing_status = 'ready', processed_at = now(), index_path = p_index_path,
      processing_report = coalesce(p_report, '{}'::jsonb), processing_error = null
  where id = p_id and processing_status = 'processing'
  returning * into draft;
  if not found then
    raise exception 'This version is not being processed' using errcode = 'P0001';
  end if;

  -- The same version number already published: leave it ready for an admin.
  if exists (select 1 from public.guideline_versions g where g.name = draft.name and g.version = draft.version) then
    return;
  end if;

  -- Publish it: the draft row goes first (the file path is in use by one of the two tables at a time).
  delete from public.guideline_version_drafts where id = draft.id;
  insert into public.guideline_versions
    (name, version, issued_date, effective_date, file_name, added_by, source, storage_path, file_size,
     index_path, draft_id, processing_report)
  values
    (draft.name, draft.version, draft.issued_date, (now() at time zone 'Asia/Riyadh')::date, draft.file_name,
     draft.created_by, draft.source, draft.storage_path, draft.file_size,
     draft.index_path, draft.id, draft.processing_report);
end;
$$;

-- Make Current (for a version left ready) also remembers its draft and report.
create or replace function public.make_guideline_current(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.guideline_version_drafts;
  new_id uuid;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select * into draft from public.guideline_version_drafts d where d.id = p_id for update;
  if not found then
    raise exception 'This version no longer exists' using errcode = 'P0002';
  end if;
  if draft.processing_status <> 'ready' or draft.index_path is null then
    raise exception 'This version has not been processed yet' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.guideline_versions g where g.name = draft.name and g.version = draft.version) then
    raise exception 'This version number is already published' using errcode = '23505';
  end if;

  delete from public.guideline_version_drafts where id = draft.id;
  insert into public.guideline_versions
    (name, version, issued_date, effective_date, file_name, added_by, source, storage_path, file_size,
     index_path, draft_id, processing_report)
  values
    (draft.name, draft.version, draft.issued_date, (now() at time zone 'Asia/Riyadh')::date, draft.file_name,
     (select auth.uid()), draft.source, draft.storage_path, draft.file_size,
     draft.index_path, draft.id, draft.processing_report)
  returning id into new_id;
  return new_id;
end;
$$;

commit;
