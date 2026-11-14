-- The first progress stage is now called "Reading the regulatory requirements file" (was "Reading the
-- PDF"), the same wording as the compliance service (hawkim/guidelines.py), so the version page's
-- progress bar shows it from 0%. Otherwise claim_guideline_processing is unchanged.
create or replace function public.claim_guideline_processing()
returns table (id uuid, version text, file_name text, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.guideline_version_drafts;
begin
  select * into draft from public.guideline_version_drafts d
  where d.processing_status = 'waiting' or public.guideline_processing_stuck(d)
  order by d.created_at
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;
  update public.guideline_version_drafts
  set processing_status = 'processing', processing_started_at = now(), processing_error = null,
      progress_percent = 0, stage = 'Reading the regulatory requirements file', stage_detail = null,
      last_progress_at = now()
  where guideline_version_drafts.id = draft.id;
  return query select draft.id, draft.version, draft.file_name, draft.storage_path;
end;
$$;
