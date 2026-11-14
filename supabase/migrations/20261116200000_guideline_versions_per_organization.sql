-- Multi-tenant, step 8: each organization has its own GVP versions and its own current version.
--
-- 1. "Current" is per organization: current_guideline_version(organization) is the organization's newest
--    published version (the old current_guideline_version(), one for the whole database, is dropped).
--    A compliance check of an SOP is made against its organization's current version.
-- 2. Version numbers are per organization: two organizations can both have GVP 4.0. Unique: (organization,
--    name, version) for published versions and (organization, version) for added ones; a new number only
--    has to be higher than the organization's own current version.
-- 3. The Admin functions for GVP versions only find the caller's organization's versions, and publishing
--    (Make Current by an Admin, or the compliance service when processing ends) puts the version in its own
--    organization. Each function is its LATEST definition (pg_get_functiondef, with every earlier migration
--    applied) with only the change named above it. Signatures, SECURITY DEFINER, search_path, owners and
--    grants are unchanged.
--
-- Next steps: one waiting or processing version per organization and the queue position; the compliance
-- checks and the compliance service's functions; the storage paths (index_path keeps 'versions/<id>' until then).
--
-- Undo: supabase/scripts/rollback_guideline_versions_per_organization.sql

begin;

-- ---------- 1. The current version of an organization ----------

create function public.current_guideline_version(p_organization_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select g.id from public.guideline_versions g
  where g.organization_id = p_organization_id
  order by g.added_at desc, g.id desc limit 1;
$$;
alter function public.current_guideline_version(uuid) owner to postgres;
revoke all on function public.current_guideline_version(uuid) from public, anon, authenticated, service_role;

-- ---------- 2. Version numbers per organization ----------

alter table public.guideline_versions drop constraint guideline_versions_name_version_key;
alter table public.guideline_versions add constraint guideline_versions_organization_id_name_version_key
  unique (organization_id, name, version);
alter table public.guideline_version_drafts drop constraint guideline_version_drafts_version_key;
alter table public.guideline_version_drafts add constraint guideline_version_drafts_organization_id_version_key
  unique (organization_id, version);

-- ---------- 3. The functions ----------

-- check_new_guideline_number: a version number only has to be new, and higher than the current version, within the caller's organization.
CREATE OR REPLACE FUNCTION public.check_new_guideline_number(p_version text, p_except uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_parts numeric[] := public.guideline_number_parts(btrim(p_version));
  v_current_parts numeric[];
begin
  if v_parts is null or length(btrim(p_version)) > 20 then
    raise exception 'The version must be digits, a dot and digits' using errcode = '23514', hint = 'version-invalid';
  end if;
  if exists (select 1 from public.guideline_versions g
             where g.organization_id = public.current_organization_id() and public.guideline_number_parts(g.version) = v_parts)
     or exists (
       select 1 from public.guideline_version_drafts d
       where d.organization_id = public.current_organization_id()
         and public.guideline_number_parts(d.version) = v_parts and d.id is distinct from p_except
     ) then
    raise exception 'This version already exists' using errcode = '23505', hint = 'version-exists';
  end if;
  select public.guideline_number_parts(g.version) into v_current_parts
  from public.guideline_versions g where g.id = public.current_guideline_version(public.current_organization_id());
  if v_current_parts is not null and v_parts <= v_current_parts then
    raise exception 'The version must be higher than the current version' using errcode = '23514', hint = 'version-not-higher';
  end if;
end;
$function$;

-- update_guideline_draft: only an added version of the caller's organization.
CREATE OR REPLACE FUNCTION public.update_guideline_draft(p_id uuid, p_name text, p_version text, p_issued_date date, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.guideline_version_drafts;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform public.lock_organization_changes(public.current_organization_id());
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  select * into v_existing from public.guideline_version_drafts d where d.id = p_id and d.organization_id = public.current_organization_id() for update;
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
$function$;

-- delete_guideline_draft: only an added version of the caller's organization.
CREATE OR REPLACE FUNCTION public.delete_guideline_draft(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.guideline_version_drafts;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform public.lock_organization_changes(public.current_organization_id());
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  select * into v_existing from public.guideline_version_drafts d where d.id = p_id and d.organization_id = public.current_organization_id() for update;
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
$function$;

-- update_guideline_version: only a published version of the caller's organization.
CREATE OR REPLACE FUNCTION public.update_guideline_version(p_id uuid, p_name text, p_issued_date date, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.guideline_versions;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform public.lock_organization_changes(public.current_organization_id());
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  select * into v_existing from public.guideline_versions g where g.id = p_id and g.organization_id = public.current_organization_id() for update;
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
$function$;

-- attach_guideline_file: only a published version of the caller's organization.
CREATE OR REPLACE FUNCTION public.attach_guideline_file(p_id uuid, p_storage_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.guideline_versions;
  v_file_size bigint;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform public.lock_organization_changes(public.current_organization_id());
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  select * into v_existing from public.guideline_versions g where g.id = p_id and g.organization_id = public.current_organization_id() for update;
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
$function$;

-- make_guideline_current: only an added version of the caller's organization; "already published" and the new current version are within that organization.
CREATE OR REPLACE FUNCTION public.make_guideline_current(p_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  draft public.guideline_version_drafts;
  passages jsonb;
  new_id uuid;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select * into draft from public.guideline_version_drafts d where d.id = p_id and d.organization_id = public.current_organization_id() for update;
  if not found then
    raise exception 'This version no longer exists' using errcode = 'P0002';
  end if;
  if draft.processing_status <> 'ready' or draft.index_path is null then
    raise exception 'This version has not been processed yet' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.guideline_versions g
             where g.organization_id = draft.organization_id and g.name = draft.name and g.version = draft.version) then
    raise exception 'This version number is already published' using errcode = '23505';
  end if;

  passages := public.guideline_draft_passages(draft.id);
  delete from public.guideline_version_drafts where id = draft.id;
  insert into public.guideline_versions
    (organization_id, name, version, issued_date, effective_date, file_name, added_by, source, storage_path, file_size,
     index_path, draft_id, processing_report)
  values
    (draft.organization_id, draft.name, draft.version, draft.issued_date, (now() at time zone 'Asia/Riyadh')::date, draft.file_name,
     (select auth.uid()), draft.source, draft.storage_path, draft.file_size,
     draft.index_path, draft.id, draft.processing_report)
  returning id into new_id;
  perform public.upsert_guideline_requirements(new_id, passages);
  return new_id;
end;
$function$;

-- complete_guideline_processing: the compliance service publishes the version into its own organization, where it becomes the current one ("already published" is checked there too).
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
$function$;

-- has_current_check: against the current version of the SOP's organization.
CREATE OR REPLACE FUNCTION public.has_current_check(p_sop sops)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select c.status = 'completed' and c.guideline_version_id = public.current_guideline_version(p_sop.organization_id)
    from public.compliance_checks c
    where c.sop_id = p_sop.id and c.sop_version = p_sop.current_version
    order by c.started_at desc
    limit 1
  ), false);
$function$;

-- start_compliance_check: only an SOP of the caller's organization, checked against that organization's current version.
CREATE OR REPLACE FUNCTION public.start_compliance_check(p_sop_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  current_upload uuid;
  guideline uuid;
  new_id uuid;
  stale public.compliance_checks;
begin
  -- Lock the SOP so two checks can't start at once.
  select * into sop from public.sops s where s.id = p_sop_id and s.organization_id = public.current_organization_id() for update;
  if not found then
    raise exception 'This SOP doesn''t exist' using errcode = 'no_data_found';
  end if;
  select v.uploaded_by into current_upload
  from public.sop_versions v where v.sop_id = p_sop_id and v.version = sop.current_version;
  if not public.is_active_user()
     or not (sop.author_id = actor or (current_upload = actor and public.is_co_author(p_sop_id, actor))) then
    raise exception 'Only the main author or the uploader of the current version can run a check' using errcode = 'insufficient_privilege';
  end if;
  if sop.status not in ('draft', 'returned', 'in-review')
     or (sop.status = 'in-review' and exists (
       select 1 from public.review_rounds r where r.sop_id = p_sop_id and r.version = sop.current_version
     )) then
    raise exception 'A compliance check can''t be run while the SOP is %', sop.status using errcode = 'check_violation';
  end if;
  if not public.sop_requires_check(sop) then
    raise exception 'Compliance checks are only for SOPs of departments the GVP guideline applies to' using errcode = 'check_violation';
  end if;

  -- A check left behind is marked failed: a sample check after 5 minutes (its tab was closed),
  -- a check of the compliance service after 30 minutes (the service stopped).
  for stale in
    update public.compliance_checks c
    set status = 'failed', completed_at = now(),
        error_message = case when c.engine = 'sample' then 'The check stopped without a result'
                             else 'The compliance service did not finish the check' end
    where c.sop_id = p_sop_id and c.status = 'running'
      and ((c.engine = 'sample' and c.started_at < now() - interval '5 minutes')
        or (c.engine <> 'sample' and c.started_at < now() - interval '30 minutes'))
    returning *
  loop
    insert into public.timeline_events (sop_id, type, actor_id, version)
    values (p_sop_id, 'compliance-check-failed', stale.triggered_by, stale.sop_version);
  end loop;

  if exists (select 1 from public.compliance_checks c where c.sop_id = p_sop_id and c.status = 'running') then
    raise exception 'A compliance check is already running' using errcode = 'check_violation';
  end if;
  -- One completed check per version and guideline version (a failed one can be run again).
  -- While the compliance service is online, a version whose completed check is a SAMPLE result
  -- can be checked again, so that it gets a real result.
  if public.has_current_check(sop) and not (
    public.compliance_engine() <> 'sample' and (
      select c.engine = 'sample' from public.compliance_checks c
      where c.sop_id = p_sop_id and c.sop_version = sop.current_version
      order by c.started_at desc limit 1)
  ) then
    raise exception 'This version already has a completed compliance check against the current guideline; upload a new version to run another check'
      using errcode = 'check_violation', hint = 'check-already-completed';
  end if;
  guideline := public.current_guideline_version(sop.organization_id);
  if guideline is null then
    raise exception 'No guideline is available to check against' using errcode = 'no_data_found';
  end if;

  insert into public.compliance_checks (sop_id, sop_version, guideline_version_id, status, engine, triggered_by)
  values (p_sop_id, sop.current_version, guideline, 'running', public.compliance_engine(), actor)
  returning id into new_id;
  return new_id;
end;
$function$;

-- Every caller now names the organization.
drop function public.current_guideline_version();

notify pgrst, 'reload schema';
commit;
