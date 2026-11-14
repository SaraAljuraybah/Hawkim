-- Undoes supabase/migrations/20261116220000_scope_compliance_checks.sql: the functions as they were before it
-- (pg_get_functiondef). Run as the owner (postgres). Only safe while MedCare is the only organization.
begin;

drop function public.claim_compliance_check(text);
drop function public.claim_guideline_processing();

CREATE OR REPLACE FUNCTION public.claim_compliance_check(p_engine text)
 RETURNS TABLE(check_id uuid, sop_id uuid, sop_version integer, storage_path text, file_name text, guideline_name text, guideline_version text, guideline_index_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.claim_guideline_processing()
 RETURNS TABLE(id uuid, version text, file_name text, storage_path text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

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
$function$

;

alter function public.claim_compliance_check(text) owner to postgres;
alter function public.claim_guideline_processing() owner to postgres;
revoke all on function public.claim_compliance_check(text), public.claim_guideline_processing() from public, anon, authenticated, service_role;
grant execute on function public.claim_compliance_check(text), public.claim_guideline_processing() to service_role;

notify pgrst, 'reload schema';
commit;
