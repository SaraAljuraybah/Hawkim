-- Clearer messages for a check that was left behind (shown on the SOP page under
-- "The compliance check couldn't be completed.").
--
-- start_compliance_check is its LIVE definition (pg_get_functiondef, 19 Nov 2026) with only the two
-- error_message texts changed:
--   sample check after 5 minutes:   'The check stopped without a result'
--   service check after 30 minutes: 'The compliance service did not finish the check'
-- Nothing else changes (no table change, same rules). Undo: run the function from
-- 20261116220000_scope_compliance_checks.sql again.

begin;

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
        error_message = case when c.engine = 'sample'
                             then 'The sample check stopped without a result because its page was closed. Run the check again.'
                             else 'The compliance checker didn''t finish this check within 30 minutes, so it was stopped. '
                               || 'Make sure the checker is running, then run the check again. If it happens again, '
                               || 'contact your administrator.' end
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
  values (p_sop_id, sop.current_version, guideline, 'running',
    -- The sample engine (the service is offline) only where this organization's version has sample findings;
    -- otherwise the check waits for the compliance service (the engine it last reported, or 'hawkim').
    case when public.compliance_engine() = 'sample'
           and not exists (select 1 from public.sample_findings f where f.guideline_version_id = guideline)
         then coalesce((select s.engine from public.compliance_service_status s where s.engine <> 'sample' limit 1), 'hawkim')
         else public.compliance_engine() end,
    actor)
  returning id into new_id;
  return new_id;
end;
$function$;

notify pgrst, 'reload schema';

commit;
