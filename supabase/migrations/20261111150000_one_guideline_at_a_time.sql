-- SFDA Regulatory Requirements: one GVP version at a time.
--
-- An admin can't add a GVP version while another added version is waiting for or being processed by the
-- compliance service (it processes one at a time, and processing takes a lot of memory on its computer).
-- A version whose processing failed doesn't block: the admin may add a corrected one.
-- create_guideline_draft is unchanged apart from this check (same signature, grants and audit).

begin;

create or replace function public.create_guideline_draft(
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

  -- One version at a time: the compliance service processes added versions one after another.
  if exists (select 1 from public.guideline_version_drafts d where d.processing_status in ('waiting', 'processing')) then
    raise exception 'Another GVP version is still being processed' using errcode = '55006', hint = 'version-processing';
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

commit;
