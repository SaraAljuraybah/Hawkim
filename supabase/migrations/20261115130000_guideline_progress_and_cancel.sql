-- SFDA Regulatory Requirements, phase 2: one overall progress percent while an added GVP version is
-- processed, and deleting a version that is being processed (it is cancelled).
--
-- 1. Progress: progress_percent (0-100, never decreases while processing), stage (e.g. "Reading the
--    PDF") and stage_detail (e.g. "page 40 of 368"). claim_guideline_processing starts them at 0% /
--    "Reading the PDF"; report_guideline_progress replaces the stage/done/total version (whose
--    processing_progress column is no longer written) and tells the service whether to go on.
-- 2. Heartbeat: while it processes a version the service reports every 2 seconds, which sets
--    last_progress_at. A version processing with no report for 2 minutes is stuck (the service
--    stopped): it can be claimed again, and Delete deletes it straight away. This replaces the
--    30 minutes after processing_started_at.
-- 3. Cancel: Delete on a version waiting for processing (or stuck) deletes it as before. On a version
--    being processed it only sets cancel_requested; the service stops, removes its index and PDF from
--    storage, then calls finish_guideline_cancellation, which deletes the row. complete_ and
--    fail_guideline_processing leave a cancelled version alone, so it is never published.
--
-- delete_guideline_draft now returns jsonb instead of the file path (dropped and created again).

begin;

alter table public.guideline_version_drafts
  add column progress_percent integer
    constraint guideline_version_drafts_progress_percent_check check (progress_percent between 0 and 100),
  add column stage text constraint guideline_version_drafts_stage_check check (length(stage) <= 100),
  add column stage_detail text constraint guideline_version_drafts_stage_detail_check check (length(stage_detail) <= 100),
  add column last_progress_at timestamptz,
  add column cancel_requested boolean not null default false;

-- Processing, but the service hasn't reported for 2 minutes (a version processing before this
-- migration has no report yet: its claim time counts).
create function public.guideline_processing_stuck(d public.guideline_version_drafts)
returns boolean
language sql
stable
set search_path = ''
as $$
  select d.processing_status = 'processing'
     and coalesce(d.last_progress_at, d.processing_started_at, '-infinity'::timestamptz) < now() - interval '2 minutes'
$$;

-- ---------- For the compliance service ----------

-- As before, with the 2-minute heartbeat rule, and it starts the progress at 0%.
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
      progress_percent = 0, stage = 'Reading the PDF', stage_detail = null, last_progress_at = now()
  where guideline_version_drafts.id = draft.id;
  return query select draft.id, draft.version, draft.file_name, draft.storage_path;
end;
$$;

drop function public.report_guideline_progress(uuid, text, integer, integer);

-- The service's heartbeat, every 2 seconds while it processes a version: saves the progress (the
-- percent never goes down) and the time, and returns 'continue', 'cancelled' (an admin deleted it:
-- stop and clean up) or 'missing' (the row is gone).
create function public.report_guideline_progress(p_id uuid, p_percent integer, p_stage text, p_detail text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.guideline_version_drafts;
begin
  select * into draft from public.guideline_version_drafts d where d.id = p_id for update;
  if not found then
    return 'missing';
  end if;
  if draft.cancel_requested then
    -- Still alive (cleaning up): not stuck.
    update public.guideline_version_drafts set last_progress_at = now()
    where id = p_id and processing_status = 'processing';
    return 'cancelled';
  end if;
  update public.guideline_version_drafts
  set progress_percent = greatest(coalesce(progress_percent, 0), least(greatest(coalesce(p_percent, 0), 0), 100)),
      stage = left(nullif(btrim(p_stage), ''), 100),
      stage_detail = left(nullif(btrim(p_detail), ''), 100),
      last_progress_at = now()
  where id = p_id and processing_status = 'processing';
  return 'continue';
end;
$$;

-- As in 20261111130000_guideline_auto_current.sql, and never for a cancelled version.
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
  where id = p_id and processing_status = 'processing' and not cancel_requested
  returning * into draft;
  if not found then
    raise exception 'This version is not being processed' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.guideline_versions g where g.name = draft.name and g.version = draft.version) then
    return;
  end if;

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

-- As before, and a cancelled version stays processing (for its cleanup) instead of failing.
create or replace function public.fail_guideline_processing(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.guideline_version_drafts
  set processing_status = 'failed', processed_at = now(),
      processing_error = left(coalesce(nullif(btrim(p_error), ''), 'Processing failed'), 500)
  where id = p_id and processing_status = 'processing' and not cancel_requested;
end;
$$;

-- The last step of a cancellation, after the service removed the version's files: deletes the row.
create function public.finish_guideline_cancellation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.guideline_version_drafts where id = p_id and cancel_requested;
end;
$$;

-- ---------- For admins ----------

drop function public.delete_guideline_draft(uuid);

-- Deletes an added version (never current). Returns {"outcome": "deleted", "storage_path": …} (the
-- browser removes the file), or {"outcome": "cancel-requested"} for a version being processed: the
-- compliance service stops and deletes it with its files.
create function public.delete_guideline_draft(p_id uuid) returns jsonb
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

  -- Being processed (the service reported in the last 2 minutes); a stuck one is deleted straight away.
  if v_existing.processing_status = 'processing' and not public.guideline_processing_stuck(v_existing) then
    update public.guideline_version_drafts set cancel_requested = true where id = v_existing.id;
    insert into public.organization_management_audit (actor_id, action, entity_id, details)
    values ((select auth.uid()), 'delete-guideline-version', v_existing.id::text,
      jsonb_build_object('version', v_existing.version, 'name', v_existing.name, 'storage_path', v_existing.storage_path,
                         'cancelled_processing', true));
    return jsonb_build_object('outcome', 'cancel-requested');
  end if;

  delete from public.guideline_version_drafts d where d.id = v_existing.id;
  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'delete-guideline-version', v_existing.id::text,
    jsonb_build_object('version', v_existing.version, 'name', v_existing.name, 'storage_path', v_existing.storage_path));
  return jsonb_build_object('outcome', 'deleted', 'storage_path', v_existing.storage_path);
end;
$$;

alter function public.guideline_processing_stuck(public.guideline_version_drafts) owner to postgres;
alter function public.delete_guideline_draft(uuid) owner to postgres;

revoke all on function public.guideline_processing_stuck(public.guideline_version_drafts) from public, anon, authenticated, service_role;
revoke all on function public.delete_guideline_draft(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.report_guideline_progress(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.finish_guideline_cancellation(uuid) from public, anon, authenticated;
grant execute on function public.delete_guideline_draft(uuid) to authenticated;
grant execute on function public.report_guideline_progress(uuid, integer, text, text) to service_role;
grant execute on function public.finish_guideline_cancellation(uuid) to service_role;

notify pgrst, 'reload schema';

commit;
