-- SFDA Regulatory Requirements, phase 2: a published GVP version has all its requirement passages.
--
-- Until now guideline_requirements was filled lazily: complete_compliance_check upserts only the
-- passages a finding refers to, so a version published from the website showed 0 requirements.
--
-- 1. When the compliance service finishes processing an added version, it saves the passages of its
--    index (units.jsonl) on the version first (save_guideline_passages, guideline_draft_requirements).
-- 2. Publishing it (complete_guideline_processing, or Make Current for a version left ready) copies
--    them into guideline_requirements in the same transaction, upserting on (guideline_version_id,
--    code) exactly like complete_compliance_check, so nothing is duplicated.
-- 3. backfill_guideline_requirements does the same for versions published before this migration; the
--    service runs it once (python worker.py --backfill-requirements) from their index files.
--
-- Deleting an added version (and cancelling it) deletes its passages with it (on delete cascade).
-- The compliance checker is unchanged: it reads the index files of published versions only.

begin;

-- The passages of an added version, between processing and publishing. Only the service writes them
-- (through save_guideline_passages); no one reads them directly.
create table public.guideline_draft_requirements (
  draft_id uuid not null references public.guideline_version_drafts (id) on delete cascade,
  code text not null check (length(btrim(code)) between 1 and 20),
  module text not null,
  section text not null,
  section_title text not null,
  short_title text not null,
  page integer not null check (page >= 1),
  summary text not null,
  primary key (draft_id, code)
);
alter table public.guideline_draft_requirements enable row level security;
revoke all on public.guideline_draft_requirements from public, anon, authenticated;

-- Upserts passages ([{code, module, section, section_title, short_title, page, summary}, …]) into a
-- published version's guideline_requirements, as complete_compliance_check does. Returns how many.
create function public.upsert_guideline_requirements(p_version_id uuid, p_passages jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved integer;
begin
  if p_passages is null or jsonb_typeof(p_passages) <> 'array' then
    raise exception 'Passages must be a list' using errcode = '22023';
  end if;
  insert into public.guideline_requirements
    (guideline_version_id, code, module, section, section_title, short_title, page, summary)
  select p_version_id, p.code, p.module, p.section, p.section_title, p.short_title, greatest(1, p.page), p.summary
  from jsonb_to_recordset(p_passages)
    as p(code text, module text, section text, section_title text, short_title text, page integer, summary text)
  on conflict (guideline_version_id, code) do update
  set module = excluded.module, section = excluded.section, section_title = excluded.section_title,
      short_title = excluded.short_title, page = excluded.page, summary = excluded.summary;
  get diagnostics saved = row_count;
  return saved;
end;
$$;

-- The passages saved on an added version, as upsert_guideline_requirements takes them.
create function public.guideline_draft_passages(p_draft_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', r.code, 'module', r.module, 'section', r.section, 'section_title', r.section_title,
    'short_title', r.short_title, 'page', r.page, 'summary', r.summary)), '[]'::jsonb)
  from public.guideline_draft_requirements r
  where r.draft_id = p_draft_id
$$;

-- ---------- For the compliance service ----------

-- Saves passages on a version being processed (in chunks); p_first replaces any saved by an earlier
-- attempt. Returns how many the version has now.
create function public.save_guideline_passages(p_id uuid, p_passages jsonb, p_first boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  total integer;
begin
  if p_passages is null or jsonb_typeof(p_passages) <> 'array' then
    raise exception 'Passages must be a list' using errcode = '22023';
  end if;
  perform 1 from public.guideline_version_drafts d
  where d.id = p_id and d.processing_status = 'processing' and not d.cancel_requested
  for update;
  if not found then
    raise exception 'This version is not being processed' using errcode = 'P0001';
  end if;
  if p_first then
    delete from public.guideline_draft_requirements where draft_id = p_id;
  end if;
  insert into public.guideline_draft_requirements
    (draft_id, code, module, section, section_title, short_title, page, summary)
  select p_id, p.code, p.module, p.section, p.section_title, p.short_title, greatest(1, p.page), p.summary
  from jsonb_to_recordset(p_passages)
    as p(code text, module text, section text, section_title text, short_title text, page integer, summary text)
  on conflict (draft_id, code) do update
  set module = excluded.module, section = excluded.section, section_title = excluded.section_title,
      short_title = excluded.short_title, page = excluded.page, summary = excluded.summary;
  select count(*) into total from public.guideline_draft_requirements where draft_id = p_id;
  return total;
end;
$$;

-- As in 20261115130000_guideline_progress_and_cancel.sql, and publishing copies the passages.
create or replace function public.complete_guideline_processing(p_id uuid, p_index_path text, p_report jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  if exists (select 1 from public.guideline_versions g where g.name = draft.name and g.version = draft.version) then
    return;
  end if;

  -- Read before the draft row (and with it its passages) is deleted.
  passages := public.guideline_draft_passages(draft.id);
  delete from public.guideline_version_drafts where id = draft.id;
  insert into public.guideline_versions
    (name, version, issued_date, effective_date, file_name, added_by, source, storage_path, file_size,
     index_path, draft_id, processing_report)
  values
    (draft.name, draft.version, draft.issued_date, (now() at time zone 'Asia/Riyadh')::date, draft.file_name,
     draft.created_by, draft.source, draft.storage_path, draft.file_size,
     draft.index_path, draft.id, draft.processing_report)
  returning id into new_id;
  perform public.upsert_guideline_requirements(new_id, passages);
end;
$$;

-- As in 20261111130000_guideline_auto_current.sql, and publishing copies the passages.
create or replace function public.make_guideline_current(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.guideline_version_drafts;
  passages jsonb;
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

  passages := public.guideline_draft_passages(draft.id);
  delete from public.guideline_version_drafts where id = draft.id;
  insert into public.guideline_versions
    (name, version, issued_date, effective_date, file_name, added_by, source, storage_path, file_size,
     index_path, draft_id, processing_report)
  values
    (draft.name, draft.version, draft.issued_date, (now() at time zone 'Asia/Riyadh')::date, draft.file_name,
     (select auth.uid()), draft.source, draft.storage_path, draft.file_size,
     draft.index_path, draft.id, draft.processing_report)
  returning id into new_id;
  perform public.upsert_guideline_requirements(new_id, passages);
  return new_id;
end;
$$;

-- One-time backfill of a version published before this migration, from its index files (in chunks).
create function public.backfill_guideline_requirements(p_version_id uuid, p_passages jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.guideline_versions g where g.id = p_version_id) then
    raise exception 'Guideline version not found' using errcode = 'P0002';
  end if;
  return public.upsert_guideline_requirements(p_version_id, p_passages);
end;
$$;

alter function public.upsert_guideline_requirements(uuid, jsonb) owner to postgres;
alter function public.guideline_draft_passages(uuid) owner to postgres;

revoke all on function public.upsert_guideline_requirements(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.guideline_draft_passages(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.save_guideline_passages(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.backfill_guideline_requirements(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_guideline_passages(uuid, jsonb, boolean) to service_role;
grant execute on function public.backfill_guideline_requirements(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
