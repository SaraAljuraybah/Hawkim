-- SFDA Regulatory Requirements, phase 2: a GVP version an admin added (guideline_version_drafts) is
-- processed by the compliance service, then an admin makes it current.
--
-- 1. A new draft waits for processing. The compliance service claims it, downloads its PDF from the
--    guideline-files bucket, splits it into requirement units, embeds them with BGE-M3 and uploads
--    the index to the private guideline-indexes bucket ('versions/<draft id>/…'). It then marks the
--    draft ready with a short report, or failed with the reason.
-- 2. An admin makes a ready draft current: it becomes a guideline_versions row (with its index path)
--    and, being the newest, current_guideline_version() returns it. New compliance checks use it;
--    earlier checks keep their own version. The draft row is removed.
--
-- Additive: adds columns to guideline_version_drafts and guideline_versions (existing rows: drafts
-- 'waiting', versions with no index path, meaning the service's local index, e.g. GVP 4.0), one
-- private bucket and these functions; claim_compliance_check also returns the version's index path.

begin;

-- ---------- Processing status of added versions ----------

alter table public.guideline_version_drafts
  add column processing_status text not null default 'waiting'
    constraint guideline_version_drafts_processing_status_check
    check (processing_status in ('waiting', 'processing', 'ready', 'failed')),
  add column processing_started_at timestamptz,
  add column processed_at timestamptz,
  add column processing_error text constraint guideline_version_drafts_processing_error_check check (length(processing_error) <= 500),
  -- e.g. {"requirements": 1505, "sections": 368, "pages": 371, "warnings": [...], "missing_excluded_sections": [...]}
  add column processing_report jsonb,
  -- Where the service stored the index in the guideline-indexes bucket.
  add column index_path text;

-- Where the index of a published version is ('versions/<id>'); null = the service's local index.
alter table public.guideline_versions add column index_path text;

-- Private bucket for the indexes: no policies, so only the service role can read or write it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('guideline-indexes', 'guideline-indexes', false, 104857600)
on conflict (id) do nothing;

-- ---------- For the compliance service ----------

-- The oldest added version waiting for processing (or left processing for 30 minutes: the service
-- stopped), marked processing.
create function public.claim_guideline_processing()
returns table (id uuid, version text, file_name text, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.guideline_version_drafts;
begin
  select * into draft from public.guideline_version_drafts d
  where d.processing_status = 'waiting'
     or (d.processing_status = 'processing' and d.processing_started_at < now() - interval '30 minutes')
  order by d.created_at
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;
  update public.guideline_version_drafts
  set processing_status = 'processing', processing_started_at = now(), processing_error = null
  where guideline_version_drafts.id = draft.id;
  return query select draft.id, draft.version, draft.file_name, draft.storage_path;
end;
$$;

create function public.complete_guideline_processing(p_id uuid, p_index_path text, p_report jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_index_path is null or p_index_path !~ '^versions/[0-9a-f-]{36}$' then
    raise exception 'Invalid index path' using errcode = '22023';
  end if;
  update public.guideline_version_drafts
  set processing_status = 'ready', processed_at = now(), index_path = p_index_path,
      processing_report = coalesce(p_report, '{}'::jsonb), processing_error = null
  where id = p_id and processing_status = 'processing';
  if not found then
    raise exception 'This version is not being processed' using errcode = 'P0001';
  end if;
end;
$$;

create function public.fail_guideline_processing(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.guideline_version_drafts
  set processing_status = 'failed', processed_at = now(),
      processing_error = left(coalesce(nullif(btrim(p_error), ''), 'Processing failed'), 500)
  where id = p_id and processing_status = 'processing';
end;
$$;

-- The check to run, with its guideline version's index path (null: the service's local index).
drop function public.claim_compliance_check(text);
create function public.claim_compliance_check(p_engine text)
returns table (check_id uuid, sop_id uuid, sop_version integer, storage_path text, file_name text,
               guideline_name text, guideline_version text, guideline_index_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  chk public.compliance_checks;
begin
  select * into chk
  from public.compliance_checks c
  where c.status = 'running' and c.engine = p_engine and not (c.metadata ? 'claimed_at')
  order by c.started_at
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;
  update public.compliance_checks
  set metadata = metadata || jsonb_build_object('claimed_at', now())
  where id = chk.id;

  return query
  select chk.id, chk.sop_id, chk.sop_version, v.storage_path, v.file_name, g.name, g.version, g.index_path
  from public.sop_versions v
  join public.guideline_versions g on g.id = chk.guideline_version_id
  where v.sop_id = chk.sop_id and v.version = chk.sop_version;
end;
$$;

-- ---------- For admins ----------

-- Processes a version again after it failed.
create function public.retry_guideline_processing(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  update public.guideline_version_drafts
  set processing_status = 'waiting', processing_started_at = null, processed_at = null, processing_error = null
  where id = p_id and processing_status = 'failed';
  if not found then
    raise exception 'Only a version whose processing failed can be processed again' using errcode = 'P0001';
  end if;
end;
$$;

-- Makes a processed version current: it becomes the newest published version. Returns its id.
create function public.make_guideline_current(p_id uuid)
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

  -- The draft row goes first: the file path is unique across both tables' uses.
  delete from public.guideline_version_drafts where id = draft.id;
  insert into public.guideline_versions
    (name, version, issued_date, effective_date, file_name, added_by, source, storage_path, file_size, index_path)
  values
    (draft.name, draft.version, draft.issued_date, (now() at time zone 'Asia/Riyadh')::date, draft.file_name,
     (select auth.uid()), draft.source, draft.storage_path, draft.file_size, draft.index_path)
  returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function public.claim_guideline_processing() from public, anon, authenticated;
revoke execute on function public.complete_guideline_processing(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_guideline_processing(uuid, text) from public, anon, authenticated;
revoke execute on function public.claim_compliance_check(text) from public, anon, authenticated;
revoke execute on function public.retry_guideline_processing(uuid) from public, anon;
revoke execute on function public.make_guideline_current(uuid) from public, anon;
grant execute on function public.claim_guideline_processing() to service_role;
grant execute on function public.complete_guideline_processing(uuid, text, jsonb) to service_role;
grant execute on function public.fail_guideline_processing(uuid, text) to service_role;
grant execute on function public.claim_compliance_check(text) to service_role;
grant execute on function public.retry_guideline_processing(uuid) to authenticated;
grant execute on function public.make_guideline_current(uuid) to authenticated;

commit;
